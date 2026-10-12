import { z } from 'zod';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { DomainError, notFound } from '@/domain/errors';
import { parseOrThrow } from '@/domain/validation';
import { listMoodTagOptions } from '@/repo/dishes';
import {
  countDislikesOfMember,
  deleteDislike,
  deleteDislikesOfHousehold,
  deleteDislikesOfMember,
  findDislikeByName,
  insertDislike,
  listDislikesOfMember,
  listExcludedNames,
  lockActiveMember,
  type DislikeRow,
} from '@/repo/taste';
import { setTasteExclusion, type TasteExclusion } from './exclusion';

export { parseCandidateFilter } from './filter';
export { buildSearchQuery, youtubeSearchUrl } from './search';
export { emptyTasteExclusion, getTasteExclusion, setTasteExclusion } from './exclusion';
export type { TasteExclusion } from './exclusion';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** BR10.1、BR10.3 */
export const NAME_MAX = 50;
export const DISLIKE_LIMIT = 50;

const NAME_MESSAGE = `食材名は 1〜${NAME_MAX} 文字で入力してください`;

// BR10.1：前後の空白を除いた 1〜50 文字。空白以外は変えずに保存する（読み替えをしない。BR10.7）
const nameSchema = z.object({
  ingredientName: z
    .string({ message: NAME_MESSAGE })
    .trim()
    .refine((s) => [...s].length >= 1 && [...s].length <= NAME_MAX, NAME_MESSAGE),
});

/** 嫌いな食材 1 件の表示用の形（BR10.5）。誰の登録かは、自分の一覧にしか出さないので持たない */
export interface DislikeView {
  id: string;
  ingredientName: string;
  registeredAt: string;
}

const toView = (r: DislikeRow): DislikeView => ({
  id: r.dislikeId,
  ingredientName: r.ingredientName,
  registeredAt: r.registeredAt.toISOString(),
});

/**
 * BR10.1〜BR10.3、BR10.23：自分の嫌いな食材を登録する。
 * memberId と householdId は入口で決めた値だけを使う（画面の入力からは決めない）。
 * 同じ食材名がすでにあれば作らず、成功として返す（created: false）。1 人 50 件まで。
 * 件数の確認と追加は、メンバーの行ロックの下で 1 件ずつ行う
 */
export async function addDislike(
  deps: AppDeps,
  ctx: HouseholdContext,
  raw: unknown,
): Promise<{ dislike: DislikeView; created: boolean }> {
  const { ingredientName } = parseOrThrow(nameSchema, raw);
  return deps.db.transaction(async (tx) => {
    // 抜けた人・他のグループの人としては登録できない（BR10.23）
    if (!(await lockActiveMember(tx, ctx.householdId, ctx.memberId))) throw notFound();
    const existing = await findDislikeByName(tx, ctx.householdId, ctx.memberId, ingredientName);
    if (existing) return { dislike: toView(existing), created: false };
    if ((await countDislikesOfMember(tx, ctx.householdId, ctx.memberId)) >= DISLIKE_LIMIT) {
      throw new DomainError('validation', '入力エラー', {
        ingredientName: `登録できるのは ${DISLIKE_LIMIT} 件までです。使わないものを外してください`,
      });
    }
    const dislikeId = deps.newId();
    const created = await insertDislike(tx, ctx.householdId, {
      dislikeId,
      memberId: ctx.memberId,
      ingredientName,
      now: deps.now(),
    });
    // 一意制約に負けた（同時に同じ登録が来た）ときは、先に入った 1 件を返す
    const row = (await findDislikeByName(tx, ctx.householdId, ctx.memberId, ingredientName))!;
    return { dislike: toView(row), created };
  });
}

/** BR10.5：自分の登録だけを、登録の古い順に返す。家族の登録は出さない */
export async function listMyDislikes(deps: AppDeps, ctx: HouseholdContext): Promise<DislikeView[]> {
  return (await listDislikesOfMember(deps.db, ctx.householdId, ctx.memberId)).map(toView);
}

/**
 * BR10.4：外せるのは本人の登録だけ。他の人・他のグループの登録は「見つからない」。
 * 履歴を残す要件はないので、物理的に消す
 */
export async function removeDislike(
  deps: AppDeps,
  ctx: HouseholdContext,
  dislikeId: string,
): Promise<void> {
  const ok =
    UUID.test(dislikeId) &&
    (await deleteDislike(deps.db, ctx.householdId, ctx.memberId, dislikeId));
  if (!ok) throw notFound();
}

/** BR10.10：気分のタグの選択肢。グループの削除済みでない料理が持つタグを集める（そのつど作る） */
export const moodTagOptions = (deps: AppDeps, ctx: HouseholdContext): Promise<string[]> =>
  listMoodTagOptions(deps.db, ctx.householdId);

const registered = new WeakSet<AppDeps>();

/**
 * 出来事の受け口を登録する（何度呼んでも 1 回だけ。ADR-007）。
 * household.member-left：そのメンバーの嫌いな食材をすべて消す（BR10.21）。
 * household.deleted：そのグループの嫌いな食材をすべて消す（BR10.22）。
 * 何度受けても、対象が 0 件でも結果は同じ。消えなかった分は、除外一覧が現在のメンバーの登録だけから作られる（BR10.6）ので、実害がない
 */
export function ensureTasteHandlers(deps: AppDeps): void {
  if (registered.has(deps)) return;
  registered.add(deps);
  deps.events.subscribe('household.member-left', async ({ householdId, memberId }) => {
    await deleteDislikesOfMember(deps.db, householdId, memberId);
  });
  deps.events.subscribe('household.deleted', async ({ householdId }) => {
    await deleteDislikesOfHousehold(deps.db, householdId);
  });
}

/**
 * 本物の実装（BR10.6）：そのグループの、現在のメンバー全員の嫌いな食材。他のグループは含めない。
 * 候補を作るたびに呼ばれるので、ここで出来事の受け口も整える
 */
export const tasteExclusion: TasteExclusion = {
  async listExcludedIngredients(deps, householdId) {
    ensureTasteHandlers(deps);
    return listExcludedNames(deps.db, householdId);
  },
};

// 候補の提案に、本物の除外を差し込む（BR10.25）。このモジュールを読み込むと有効になる（U5 の setImpressionJudge と同じ形）
setTasteExclusion(tasteExclusion);
