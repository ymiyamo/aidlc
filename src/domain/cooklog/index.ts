import { z } from 'zod';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { DomainError, notFound } from '@/domain/errors';
import { memberLabel } from '@/domain/household';
import { setImpressionJudge, type LatestImpression } from '@/domain/suggestion';
import { parseOrThrow } from '@/domain/validation';
import { getDish } from '@/repo/dishes';
import {
  deleteRecord,
  deleteRecordsOfHousehold,
  findRecordByDishDay,
  getDishNames,
  getMemberLabels,
  getRecord,
  insertRecord,
  latestImpressionRows,
  listRecordsBetween,
  listRecordsByDish,
  updateRecord,
  type CookRecordRow,
  type Impression,
} from '@/repo/cooklog';
import { currentMonthJst, isRealDate, monthRange, todayJst } from './dates';

export { currentMonthJst, isRealDate, monthRange, todayJst } from './dates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 空・空白だけは「未入力（null）」として扱う */
const emptyToNull = (v: unknown) => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v ?? null;
};

// BR40.1〜BR40.3：作った日・感想・メモ。追加と編集で共通
const fieldsSchema = z.object({
  cookedOn: z
    .string({ message: '作った日を入力してください' })
    .trim()
    .refine(isRealDate, '実在する日付を入力してください'),
  impression: z.preprocess(
    emptyToNull,
    z.enum(['again', 'never_again'], { message: '感想の選択肢が正しくありません' }).nullable(),
  ),
  cautionMemo: z.preprocess(emptyToNull, z.string().max(1000, 'メモは1000文字までです').nullable()),
});

export const FUTURE_DATE_MESSAGE = '未来の日付は選べません';

/** 記録 1 件の表示用の形。料理名と記録した人の表示名は、表示のたびに作る（BR40.11、BR40.23） */
export interface CookRecordView {
  recordId: string;
  dishId: string;
  dishName: string;
  dishDeleted: boolean;
  cookedOn: string;
  impression: Impression | null;
  cautionMemo: string | null;
  memberLabel: string;
  createdAt: string;
}

export interface CalendarDay {
  date: string;
  count: number;
  /** カレンダーに出す短い表示。複数あるときは「ほか N 件」を添える（BR40.12） */
  label: string;
  impression: Impression | 'none';
}

export interface MonthView {
  month: string;
  today: string;
  days: CalendarDay[];
  records: CookRecordView[];
}

/** カレンダー用に、料理名を 8 文字までにする（BR40.12） */
export const SHORT_NAME_LIMIT = 8;
export const shortName = (name: string) => {
  const chars = [...name];
  return chars.length > SHORT_NAME_LIMIT ? `${chars.slice(0, SHORT_NAME_LIMIT).join('')}…` : name;
};

async function toViews(
  deps: AppDeps,
  householdId: string,
  rows: CookRecordRow[],
): Promise<CookRecordView[]> {
  const [dishes, members] = await Promise.all([
    getDishNames(deps.db, householdId, [...new Set(rows.map((r) => r.dishId))]),
    getMemberLabels(deps.db, householdId, [...new Set(rows.map((r) => r.memberId))]),
  ]);
  return rows.map((r) => {
    const dish = dishes.get(r.dishId);
    const member = members.get(r.memberId);
    return {
      recordId: r.recordId,
      dishId: r.dishId,
      dishName: dish?.name ?? '（不明な料理）',
      dishDeleted: dish?.deleted ?? false,
      cookedOn: r.cookedOn,
      impression: r.impression,
      cautionMemo: r.cautionMemo,
      memberLabel: memberLabel(member ?? { displayName: null, leftAt: null }),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

const futureError = () =>
  new DomainError(
    'validation',
    '入力エラー',
    { cookedOn: FUTURE_DATE_MESSAGE },
    {
      code: 'FUTURE_DATE_NOT_ALLOWED',
    },
  );

const duplicateError = (existingRecordId: string) =>
  new DomainError('conflict', 'この日の記録がすでにあります', undefined, {
    code: 'DUPLICATE_RECORD',
    existingRecordId,
  });

/**
 * BR40.1〜BR40.6、BR40.17：作った日を追加する。
 * 料理は自分のグループの削除済みでないものだけ（DishCatalog.exists 相当。BR40.5）。householdId は入力から受け取らない
 */
export async function addRecord(
  deps: AppDeps,
  ctx: HouseholdContext,
  raw: unknown,
): Promise<CookRecordView> {
  const input = parseOrThrow(fieldsSchema.extend({ dishId: z.string() }), raw);
  if (!UUID.test(input.dishId) || !(await getDish(deps.db, ctx.householdId, input.dishId))) {
    throw notFound();
  }
  if (input.cookedOn > todayJst(deps.now())) throw futureError();
  const recordId = deps.newId();
  const res = await insertRecord(deps.db, ctx.householdId, {
    recordId,
    dishId: input.dishId,
    memberId: ctx.memberId,
    cookedOn: input.cookedOn,
    impression: input.impression,
    cautionMemo: input.cautionMemo,
    now: deps.now(),
  });
  if (!res.created) throw duplicateError(res.existingRecordId);
  const row = (await getRecord(deps.db, ctx.householdId, recordId))!;
  return (await toViews(deps, ctx.householdId, [row]))[0];
}

/** BR40.8：作った日・感想・メモだけを置き換える。他のグループの記録は見つからない（BR40.10） */
export async function editRecord(
  deps: AppDeps,
  ctx: HouseholdContext,
  recordId: string,
  raw: unknown,
): Promise<CookRecordView> {
  const input = parseOrThrow(fieldsSchema, raw);
  const current = UUID.test(recordId) ? await getRecord(deps.db, ctx.householdId, recordId) : null;
  if (!current) throw notFound();
  if (input.cookedOn > todayJst(deps.now())) throw futureError();
  const result = await updateRecord(deps.db, ctx.householdId, recordId, {
    cookedOn: input.cookedOn,
    impression: input.impression,
    cautionMemo: input.cautionMemo,
    now: deps.now(),
  });
  if (result === 'not_found') throw notFound();
  if (result === 'duplicate') {
    const other = await findRecordByDishDay(
      deps.db,
      ctx.householdId,
      current.dishId,
      input.cookedOn,
    );
    throw duplicateError(other?.recordId ?? recordId);
  }
  const row = (await getRecord(deps.db, ctx.householdId, recordId))!;
  return (await toViews(deps, ctx.householdId, [row]))[0];
}

/** BR40.9：その 1 件だけを消す。確認は画面が行う。他のグループの記録は見つからない */
export async function removeRecord(
  deps: AppDeps,
  ctx: HouseholdContext,
  recordId: string,
): Promise<void> {
  const ok = UUID.test(recordId) && (await deleteRecord(deps.db, ctx.householdId, recordId));
  if (!ok) throw notFound();
}

/** BR40.7：その料理を作った回数と、作った日の一覧（新しい順）。他のグループ・削除済みの料理は見つからない */
export async function dishRecords(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
): Promise<{ count: number; today: string; records: CookRecordView[] }> {
  if (!UUID.test(dishId) || !(await getDish(deps.db, ctx.householdId, dishId))) throw notFound();
  const rows = await listRecordsByDish(deps.db, ctx.householdId, dishId);
  return {
    count: rows.length,
    // 画面の初期値と選べる上限のために、サーバーが決めた日本時間の今日を返す（BR40.6、BR40.22）
    today: todayJst(deps.now()),
    records: await toViews(deps, ctx.householdId, rows),
  };
}

/** BR40.12、BR40.13：月のカレンダーと一覧。月は「年-月」（日本時間）。未指定は今月 */
export async function monthView(
  deps: AppDeps,
  ctx: HouseholdContext,
  month?: string | null,
): Promise<MonthView> {
  const target = month ? month : currentMonthJst(deps.now());
  const range = monthRange(target);
  if (!range) {
    throw new DomainError('validation', '入力エラー', {
      month: '年-月の形（例：2026-10）で指定してください',
    });
  }
  const rows = await listRecordsBetween(deps.db, ctx.householdId, range.from, range.to);
  const records = await toViews(deps, ctx.householdId, rows);
  // records は作った日の新しい順、同じ日は作成の新しい順。日ごとの先頭が表示の代表
  const byDay = new Map<string, CookRecordView[]>();
  for (const r of records) byDay.set(r.cookedOn, [...(byDay.get(r.cookedOn) ?? []), r]);
  const days: CalendarDay[] = [...byDay.entries()]
    .map(([date, list]) => ({
      date,
      count: list.length,
      label:
        list.length > 1
          ? `${shortName(list[0].dishName)} ほか${list.length - 1}件`
          : shortName(list[0].dishName),
      impression: list[0].impression ?? ('none' as const),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { month: target, today: todayJst(deps.now()), days, records };
}

/**
 * BR40.19：料理ごとの最新の感想を一括で答える（契約 C2 の CookLogImpression）。
 * 記録のない料理・無い ID・他のグループの ID は none
 */
export async function latestImpressionsByDish(
  deps: AppDeps,
  householdId: string,
  dishIds: string[],
): Promise<Map<string, LatestImpression>> {
  const rows = await latestImpressionRows(deps.db, householdId, dishIds);
  return new Map(dishIds.map((id) => [id, rows.get(id) ?? 'none'] as const));
}

const registered = new WeakSet<AppDeps>();

/**
 * 出来事の受け口を登録する（何度呼んでも 1 回だけ）。
 * household.deleted を受けたら、そのグループの記録をすべて消す。何度受けても結果は同じ（BR40.21、ADR-007）
 */
export function ensureCookLogHandlers(deps: AppDeps): void {
  if (registered.has(deps)) return;
  registered.add(deps);
  deps.events.subscribe('household.deleted', async ({ householdId }) => {
    await deleteRecordsOfHousehold(deps.db, householdId);
  });
}

// 候補の提案に、最新の感想による並べ替えを差し込む（BR40.20）。このモジュールを読み込むと有効になる
setImpressionJudge(latestImpressionsByDish);
