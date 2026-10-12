import { z } from 'zod';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { DomainError, notFound } from '@/domain/errors';
import { memberLabel } from '@/domain/household';
import { pickedList, unpick } from '@/domain/suggestion';
import { parseOrThrow } from '@/domain/validation';
import {
  applyItemChanges,
  deleteListsOfHousehold,
  ensureActiveList,
  findActiveList,
  getDishNames,
  getItem,
  getList,
  getMemberLabels,
  listItems,
  listPendingUnpick,
  markCompleted,
  markUnpickDone,
  writeChecked,
  type ItemContent,
  type ListSource,
  type ListStatus,
  type ShoppingItemRow,
  type ShoppingListRow,
} from '@/repo/shopping';
import { normalizeDecimalString } from './amount';
import { aggregateIngredients, type ComposeDish } from './compose';

export { aggregateIngredients, type ComposeDish, type ComposeIngredient } from './compose';
export { displayAmount, parseAmount } from './amount';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** BR20.16、ADR-008：削除済みの料理の名前の代わり */
export const DELETED_DISH_LABEL = '削除された料理';
/** BR20.3：最新の状態にできなかったときの知らせ */
export const STALE_MESSAGE = '最新の状態にできませんでした';

/** 行に出す元の料理 */
export interface ShoppingDishRef {
  dishId: string;
  name: string;
  deleted: boolean;
}

/** 行 1 つの表示用の形（BR20.8、BR20.16） */
export interface ShoppingItemView {
  itemId: string;
  kind: 'ingredient' | 'needsInput';
  ingredientName: string | null;
  unit: string;
  /** 分量の表示（「3」「少々」。分量が空なら空文字）。単位は含まない */
  amountLabel: string;
  dishes: ShoppingDishRef[];
  checked: boolean;
  checkedByLabel: string | null;
  checkedAt: string | null;
}

/** 買い物リスト 1 つの表示用の形 */
export interface ShoppingListView {
  listId: string;
  source: ListSource;
  planId: string | null;
  status: ListStatus;
  /** 表示する行が 0 件（BR20.12）。「材料の入力が必要」の行だけなら空ではない */
  empty: boolean;
  /** 最新の状態にできず、前回保存した内容を出している（BR20.3） */
  stale: boolean;
  completedAt: string | null;
  completedByLabel: string | null;
  items: ShoppingItemView[];
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** BR20.9：材料の入力が必要な行 → チェックのない行 → チェックのある行。中は材料名の順、同じ名前なら単位の順 */
function orderRows(rows: ShoppingItemRow[], dishName: (id: string) => string): ShoppingItemRow[] {
  const group = (r: ShoppingItemRow) => (r.kind === 'needsInput' ? 0 : r.checked ? 2 : 1);
  const label = (r: ShoppingItemRow) =>
    r.kind === 'needsInput' ? dishName(r.sourceDishIds[0]) : (r.ingredientName ?? '');
  return [...rows].sort(
    (a, b) =>
      group(a) - group(b) ||
      byCode(label(a), label(b)) ||
      byCode(a.unit, b.unit) ||
      byCode(a.lineKey, b.lineKey),
  );
}

async function toView(
  deps: AppDeps,
  householdId: string,
  list: ShoppingListRow,
  rows: ShoppingItemRow[],
  stale: boolean,
): Promise<ShoppingListView> {
  const dishIds = [...new Set(rows.flatMap((r) => r.sourceDishIds))];
  const memberIds = [
    ...new Set([
      ...rows.map((r) => r.checkedBy).filter((m): m is string => m !== null),
      ...(list.completedBy ? [list.completedBy] : []),
    ]),
  ];
  const [dishes, members] = await Promise.all([
    getDishNames(deps.db, householdId, dishIds),
    getMemberLabels(deps.db, householdId, memberIds),
  ]);
  const ref = (dishId: string): ShoppingDishRef => {
    const d = dishes.get(dishId);
    // 削除済み・見つからない料理は、名前の代わりに固定の文言を出す（ADR-008）
    return d && !d.deleted
      ? { dishId, name: d.name, deleted: false }
      : { dishId, name: DELETED_DISH_LABEL, deleted: true };
  };
  const label = (memberId: string | null) =>
    memberId === null
      ? null
      : memberLabel(members.get(memberId) ?? { displayName: null, leftAt: null });

  const ordered = orderRows(rows, (id) => ref(id).name);
  return {
    listId: list.listId,
    source: list.source,
    planId: list.sourcePlanId,
    status: list.status,
    empty: rows.length === 0,
    stale,
    completedAt: list.completedAt ? list.completedAt.toISOString() : null,
    completedByLabel: label(list.completedBy),
    items: ordered.map((r) => ({
      itemId: r.itemId,
      kind: r.kind,
      ingredientName: r.ingredientName,
      unit: r.unit,
      amountLabel: r.amountKind === 'none' || r.amountKind === null ? '' : (r.amountText ?? ''),
      dishes: r.sourceDishIds.map(ref),
      checked: r.checked,
      checkedByLabel: label(r.checkedBy),
      checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
    })),
  };
}

const viewOf = async (deps: AppDeps, householdId: string, list: ShoppingListRow, stale = false) =>
  toView(deps, householdId, list, await listItems(deps.db, householdId, list.listId), stale);

type ListBy = { source: 'picked' } | { source: 'mealPlan'; planId: string };

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/**
 * BR20.3、BR20.11：作成中のリストを、あるべき行の一覧にそろえる。
 * 足す・外す・残すを lineKey で決め、1 つの取引で反映する（一部だけ変わった状態を残さない）。
 * 同じ行は、チェックを引き継ぐ。分量が変わった行は、チェックを外す。同時の同期は行ロックで順番になる
 */
async function syncList(
  deps: AppDeps,
  householdId: string,
  by: ListBy,
  desired: ItemContent[],
): Promise<ShoppingListRow> {
  return deps.db.transaction(async (tx) => {
    // 作る → ロックを取って読み直す。間に完了されて見つからなければ、1 回だけ作り直す
    let list: ShoppingListRow | null = null;
    for (let attempt = 0; attempt < 2 && !list; attempt++) {
      await ensureActiveList(tx, householdId, by, { listId: deps.newId(), now: deps.now() });
      list = await findActiveList(tx, householdId, by, true);
    }
    if (!list) throw new Error('shopping_list_sync_failed');

    const current = await listItems(tx, householdId, list.listId);
    const byKey = new Map(current.map((r) => [r.lineKey, r]));
    const wanted = new Set(desired.map((d) => d.lineKey));

    const insert: (ItemContent & { itemId: string })[] = [];
    const update: { itemId: string; content: ItemContent; resetCheck: boolean }[] = [];
    for (const d of desired) {
      const r = byKey.get(d.lineKey);
      if (!r) {
        insert.push({ ...d, itemId: deps.newId() });
        continue;
      }
      const amountChanged =
        r.amountKind !== d.amountKind ||
        normalizeDecimalString(r.amountNumber) !== normalizeDecimalString(d.amountNumber) ||
        (r.amountText ?? null) !== (d.amountText ?? null);
      if (amountChanged || !sameSet(r.sourceDishIds, d.sourceDishIds)) {
        update.push({ itemId: r.itemId, content: d, resetCheck: amountChanged });
      }
    }
    const deleteItemIds = current.filter((r) => !wanted.has(r.lineKey)).map((r) => r.itemId);

    await applyItemChanges(tx, householdId, list.listId, { insert, update, deleteItemIds });
    return list;
  });
}

/** 「選んだもの」の今の状態にそろえる（BR20.3）。選んだ料理の材料は、U1 の「選んだもの」の窓口から読む */
async function syncPicked(deps: AppDeps, ctx: HouseholdContext): Promise<ShoppingListRow> {
  const picked = await pickedList(deps, ctx);
  const dishes: ComposeDish[] = picked.map((p) => ({
    dishId: p.dish.dishId,
    name: p.dish.name,
    ingredients: p.dish.ingredients,
  }));
  return syncList(deps, ctx.householdId, { source: 'picked' }, aggregateIngredients(dishes));
}

/**
 * BR20.13：完了時に決めた料理を「選んだもの」から外す。外すのは、完了時刻以前から選ばれていたものに限る
 * （完了後に選び直したものは外さない）。すでに外れていても成功（何度やっても同じ）。全部外せたら印を付ける
 */
async function performUnpick(
  deps: AppDeps,
  ctx: HouseholdContext,
  list: Pick<ShoppingListRow, 'listId' | 'unpickDishIds' | 'completedAt'>,
): Promise<void> {
  const picked = await pickedList(deps, ctx);
  const pickedAt = new Map(picked.map((p) => [p.dish.dishId, p.pickedAt]));
  for (const dishId of list.unpickDishIds) {
    const at = pickedAt.get(dishId);
    if (at && list.completedAt && at.getTime() <= list.completedAt.getTime()) {
      await unpick(deps, ctx, dishId);
    }
  }
  await markUnpickDone(deps.db, ctx.householdId, list.listId);
}

/** BR20.13：外し残しのやり直し。失敗しても呼び出し元の操作は続ける（記録だけ残す） */
async function retryPendingUnpicks(deps: AppDeps, ctx: HouseholdContext): Promise<void> {
  try {
    for (const list of await listPendingUnpick(deps.db, ctx.householdId)) {
      await performUnpick(deps, ctx, list);
    }
  } catch (err) {
    deps.logger.error('shopping_unpick_retry_failed', { error: err });
  }
}

/**
 * WF1（BR20.2、BR20.3）：買い物リストを開く。外し残しのやり直しを先に行い、
 * 作成中のリストがなければ作り、今の「選んだもの」にそろえて返す。
 * そろえられなかったときは、前回保存した内容を stale 付きで返す
 */
export async function openShoppingList(
  deps: AppDeps,
  ctx: HouseholdContext,
): Promise<ShoppingListView> {
  ensureShoppingHandlers(deps);
  await retryPendingUnpicks(deps, ctx);
  try {
    const list = await syncPicked(deps, ctx);
    return await viewOf(deps, ctx.householdId, list);
  } catch (err) {
    deps.logger.error('shopping_sync_failed', { error: err });
    const saved = await findActiveList(deps.db, ctx.householdId, { source: 'picked' });
    if (!saved) throw err;
    return viewOf(deps, ctx.householdId, saved, true);
  }
}

/**
 * WF2（BR20.10）：チェックを付ける・外す。切り替えではなく、結果の値を指定する（繰り返しても同じ）。
 * 他のグループの行は見つからない（BR20.1）。「材料の入力が必要」の行・完了したリストの行は変えない
 */
export async function setItemChecked(
  deps: AppDeps,
  ctx: HouseholdContext,
  itemId: string,
  checked: unknown,
): Promise<ShoppingItemView> {
  if (typeof checked !== 'boolean') {
    throw new DomainError('validation', '入力エラー', {
      checked: 'true か false を指定してください',
    });
  }
  const item = UUID.test(itemId) ? await getItem(deps.db, ctx.householdId, itemId) : null;
  if (!item) throw notFound();
  if (item.kind === 'needsInput') {
    throw new DomainError('conflict', 'チェックできません', undefined, {
      code: 'NEEDS_INPUT_NOT_CHECKABLE',
    });
  }
  if (item.listStatus === 'completed') {
    throw new DomainError('conflict', 'チェックできません', undefined, {
      code: 'LIST_COMPLETED',
    });
  }
  const ok = await writeChecked(deps.db, ctx.householdId, itemId, {
    checked,
    memberId: ctx.memberId,
    now: deps.now(),
  });
  if (!ok)
    throw new DomainError('conflict', 'チェックできません', undefined, { code: 'NOT_WRITABLE' });
  const list = (await getList(deps.db, ctx.householdId, item.listId))!;
  const view = await viewOf(deps, ctx.householdId, list);
  const found = view.items.find((i) => i.itemId === itemId);
  if (!found) throw notFound();
  return found;
}

export interface CompleteResult {
  /** すでに完了していた（または完了する作成中のリストがなかった）。成功として返す */
  alreadyCompleted: boolean;
  /** 「選んだもの」から外しきれず、次に開くときにやり直す */
  unpickPending: boolean;
}

/**
 * WF4（BR20.13）：「買い物おわり」。今の「選んだもの」にそろえてから完了し、リストの料理を「選んだもの」から外す。
 * 外す対象は完了と同じ保存で記録しておく。外すのに失敗しても完了は取り消さず、次に開くときにやり直す。
 * チェックがすべて付いていなくても完了できる。繰り返しても結果は同じ
 */
export async function completeShoppingList(
  deps: AppDeps,
  ctx: HouseholdContext,
): Promise<CompleteResult> {
  ensureShoppingHandlers(deps);
  await retryPendingUnpicks(deps, ctx);
  const by: ListBy = { source: 'picked' };
  if (!(await findActiveList(deps.db, ctx.householdId, by))) {
    return { alreadyCompleted: true, unpickPending: false };
  }
  await syncPicked(deps, ctx);

  const now = deps.now();
  const completed = await deps.db.transaction(async (tx) => {
    const list = await findActiveList(tx, ctx.householdId, by, true);
    if (!list) return null;
    const items = await listItems(tx, ctx.householdId, list.listId);
    const unpickDishIds = [...new Set(items.flatMap((i) => i.sourceDishIds))];
    const unpickDone = unpickDishIds.length === 0;
    const ok = await markCompleted(tx, ctx.householdId, list.listId, {
      memberId: ctx.memberId,
      now,
      unpickDishIds,
      unpickDone,
    });
    return ok ? { listId: list.listId, unpickDishIds, unpickDone, completedAt: now } : null;
  });
  if (!completed) return { alreadyCompleted: true, unpickPending: false };
  if (completed.unpickDone) return { alreadyCompleted: false, unpickPending: false };

  try {
    await performUnpick(deps, ctx, completed);
    return { alreadyCompleted: false, unpickPending: false };
  } catch (err) {
    deps.logger.error('shopping_unpick_failed', { error: err });
    return { alreadyCompleted: false, unpickPending: true };
  }
}

// ---------- 献立（U4）からの受け口（BR20.14、ADR-010） ----------

const composeSchema = z.object({
  planId: z
    .string({ message: '献立を指定してください' })
    .trim()
    .min(1, '献立を指定してください')
    .max(100, '献立の ID が長すぎます'),
  dishes: z.array(
    z.object({
      dishId: z.string().regex(UUID, '料理の ID の形が正しくありません'),
      name: z.string().max(100).optional(),
      ingredients: z.array(
        z.object({
          name: z
            .string()
            .trim()
            .min(1, '材料名を入力してください')
            .max(50, '材料名は50文字までです'),
          amount: z.string().trim().max(30, '分量は30文字までです').nullish(),
          unit: z.string().trim().max(20, '単位は20文字までです').nullish(),
        }),
      ),
    }),
  ),
});

export interface ComposeInput {
  /** 献立の ID。ID だけの参照（ADR-009）で、U3 は献立の中身を知らない */
  planId: string;
  /** 「作らない」日の料理を除いた、料理と材料（除く判断は U4） */
  dishes: {
    dishId: string;
    name?: string;
    ingredients: { name: string; amount?: string | null; unit?: string | null }[];
  }[];
}

/**
 * ShoppingListCompose.composeFromIngredients（BR20.14）。U4 が呼ぶ。
 * 渡された材料から、「選んだもの」とは別の献立用のリストを、同じ集計の規則で作る。
 * 同じ献立の作成中のリストがあれば、中身を置き換え、チェックを引き継ぐ。材料が空なら空のリストを作る
 */
export async function composeFromIngredients(
  deps: AppDeps,
  ctx: HouseholdContext,
  raw: ComposeInput,
): Promise<ShoppingListView> {
  ensureShoppingHandlers(deps);
  const input = parseOrThrow(composeSchema, raw);
  const dishes: ComposeDish[] = input.dishes.map((d) => ({
    dishId: d.dishId,
    name: d.name ?? '',
    ingredients: d.ingredients.map((i) => ({
      name: i.name,
      amount: i.amount ?? null,
      unit: i.unit ?? null,
    })),
  }));
  const list = await syncList(
    deps,
    ctx.householdId,
    { source: 'mealPlan', planId: input.planId },
    aggregateIngredients(dishes),
  );
  return viewOf(deps, ctx.householdId, list);
}

/**
 * BR20.14：献立用のリストの完了。BR20.13 の (1)(2) と同じで、「選んだもの」は外さない。
 * 作成中のリストがなければ、すでに完了として成功を返す
 */
export async function completeMealPlanList(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
): Promise<CompleteResult> {
  ensureShoppingHandlers(deps);
  const by: ListBy = { source: 'mealPlan', planId };
  const done = await deps.db.transaction(async (tx) => {
    const list = await findActiveList(tx, ctx.householdId, by, true);
    if (!list) return false;
    return markCompleted(tx, ctx.householdId, list.listId, {
      memberId: ctx.memberId,
      now: deps.now(),
      unpickDishIds: [],
      unpickDone: true,
    });
  });
  return { alreadyCompleted: !done, unpickPending: false };
}

/** 献立用の作成中のリストを読む（なければ null）。同期はしない */
export async function getMealPlanList(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
): Promise<ShoppingListView | null> {
  const list = await findActiveList(deps.db, ctx.householdId, { source: 'mealPlan', planId });
  return list ? viewOf(deps, ctx.householdId, list) : null;
}

// ---------- グループ削除の受け口（BR20.15、ADR-007） ----------

const registered = new WeakSet<AppDeps>();

/**
 * 出来事の受け口を登録する（何度呼んでも 1 回だけ）。
 * household.deleted を受けたら、そのグループの買い物リストと行をすべて消す。何度受けても結果は同じ
 */
export function ensureShoppingHandlers(deps: AppDeps): void {
  if (registered.has(deps)) return;
  registered.add(deps);
  deps.events.subscribe('household.deleted', async ({ householdId }) => {
    await deleteListsOfHousehold(deps.db, householdId);
  });
}
