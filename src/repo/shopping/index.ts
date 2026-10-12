import type { Queryable } from '@/db/types';

export type ListSource = 'picked' | 'mealPlan';
export type ListStatus = 'active' | 'completed';
export type ItemKind = 'ingredient' | 'needsInput';
export type AmountKind = 'numeric' | 'text' | 'none';

export interface ShoppingListRow {
  listId: string;
  householdId: string;
  source: ListSource;
  sourcePlanId: string | null;
  status: ListStatus;
  createdAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  unpickDishIds: string[];
  unpickDone: boolean;
}

export interface ShoppingItemRow {
  itemId: string;
  listId: string;
  householdId: string;
  lineKey: string;
  kind: ItemKind;
  ingredientName: string | null;
  /** 空は「単位なし」 */
  unit: string;
  amountKind: AmountKind | null;
  /** 10 進の文字列（例：3、0.5）。numeric のときだけ */
  amountNumber: string | null;
  amountText: string | null;
  sourceDishIds: string[];
  checked: boolean;
  checkedBy: string | null;
  checkedAt: Date | null;
}

/** 行の中身（itemId・チェックの状態を除いた、組み立てた結果）。domain と repo の受け渡しに使う */
export interface ItemContent {
  lineKey: string;
  kind: ItemKind;
  ingredientName: string | null;
  unit: string;
  amountKind: AmountKind | null;
  amountNumber: string | null;
  amountText: string | null;
  sourceDishIds: string[];
}

interface RawList {
  list_id: string;
  household_id: string;
  source: ListSource;
  source_plan_id: string | null;
  status: ListStatus;
  created_at: Date;
  completed_at: Date | null;
  completed_by: string | null;
  unpick_dish_ids: string[];
  unpick_done: boolean;
}

interface RawItem {
  item_id: string;
  list_id: string;
  household_id: string;
  line_key: string;
  kind: ItemKind;
  ingredient_name: string | null;
  unit: string | null;
  amount_kind: AmountKind | null;
  amount_number: string | null;
  amount_text: string | null;
  source_dish_ids: string[];
  checked: boolean;
  checked_by: string | null;
  checked_at: Date | null;
}

const LIST_COLUMNS = `list_id, household_id, source, source_plan_id, status, created_at,
  completed_at, completed_by, unpick_dish_ids, unpick_done`;

// numeric は文字列で受け取る（ドライバによって型が違うため。10 進の値を丸めずに読む）
const ITEM_COLUMNS = `item_id, list_id, household_id, line_key, kind, ingredient_name, unit,
  amount_kind, amount_number::text as amount_number, amount_text, source_dish_ids,
  checked, checked_by, checked_at`;

const toList = (r: RawList): ShoppingListRow => ({
  listId: r.list_id,
  householdId: r.household_id,
  source: r.source,
  sourcePlanId: r.source_plan_id,
  status: r.status,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  completedBy: r.completed_by,
  unpickDishIds: r.unpick_dish_ids,
  unpickDone: r.unpick_done,
});

const toItem = (r: RawItem): ShoppingItemRow => ({
  itemId: r.item_id,
  listId: r.list_id,
  householdId: r.household_id,
  lineKey: r.line_key,
  kind: r.kind,
  ingredientName: r.ingredient_name,
  unit: r.unit ?? '',
  amountKind: r.amount_kind,
  amountNumber: r.amount_number,
  amountText: r.amount_text,
  sourceDishIds: r.source_dish_ids,
  checked: r.checked,
  checkedBy: r.checked_by,
  checkedAt: r.checked_at,
});

/**
 * 作成中のリストを探す。picked は 1 グループ 1 件、mealPlan は献立の ID ごとに 1 件（BR20.2、BR20.14）。
 * forUpdate を付けると行ロックを取る（同時の同期を順番に処理するため。取引の中で呼ぶこと）
 */
export async function findActiveList(
  q: Queryable,
  householdId: string,
  by: { source: 'picked' } | { source: 'mealPlan'; planId: string },
  forUpdate = false,
): Promise<ShoppingListRow | null> {
  const lock = forUpdate ? ' for update' : '';
  const res =
    by.source === 'picked'
      ? await q.query<RawList>(
          `select ${LIST_COLUMNS} from shopping_lists
           where household_id = $1 and source = 'picked' and status = 'active'${lock}`,
          [householdId],
        )
      : await q.query<RawList>(
          `select ${LIST_COLUMNS} from shopping_lists
           where household_id = $1 and source = 'mealPlan' and source_plan_id = $2
             and status = 'active'${lock}`,
          [householdId, by.planId],
        );
  return res.rows[0] ? toList(res.rows[0]) : null;
}

/**
 * 作成中のリストを作る。すでにあれば作らず、あるものを返す（同時に 2 つの「開く」が来ても 1 件。BR20.2）
 */
export async function ensureActiveList(
  q: Queryable,
  householdId: string,
  by: { source: 'picked' } | { source: 'mealPlan'; planId: string },
  v: { listId: string; now: Date },
): Promise<ShoppingListRow> {
  const planId = by.source === 'mealPlan' ? by.planId : null;
  await q.query(
    `insert into shopping_lists (list_id, household_id, source, source_plan_id, created_at)
     values ($1, $2, $3, $4, $5)
     on conflict do nothing`,
    [v.listId, householdId, by.source, planId, v.now],
  );
  const found = await findActiveList(q, householdId, by);
  if (!found) throw new Error('shopping_list_ensure_failed');
  return found;
}

/** 他のグループのリストは null（BR20.1） */
export async function getList(
  q: Queryable,
  householdId: string,
  listId: string,
): Promise<ShoppingListRow | null> {
  const res = await q.query<RawList>(
    `select ${LIST_COLUMNS} from shopping_lists where household_id = $1 and list_id = $2`,
    [householdId, listId],
  );
  return res.rows[0] ? toList(res.rows[0]) : null;
}

/** 行の一覧（並び順は決めない。並べるのは業務ロジック。BR20.9） */
export async function listItems(
  q: Queryable,
  householdId: string,
  listId: string,
): Promise<ShoppingItemRow[]> {
  const res = await q.query<RawItem>(
    `select ${ITEM_COLUMNS} from shopping_items
     where household_id = $1 and list_id = $2
     order by line_key`,
    [householdId, listId],
  );
  return res.rows.map(toItem);
}

export async function getItem(
  q: Queryable,
  householdId: string,
  itemId: string,
): Promise<(ShoppingItemRow & { listStatus: ListStatus }) | null> {
  const res = await q.query<RawItem & { list_status: ListStatus }>(
    `select i.item_id, i.list_id, i.household_id, i.line_key, i.kind, i.ingredient_name, i.unit,
            i.amount_kind, i.amount_number::text as amount_number, i.amount_text,
            i.source_dish_ids, i.checked, i.checked_by, i.checked_at,
            l.status as list_status
     from shopping_items i join shopping_lists l on l.list_id = i.list_id
     where i.household_id = $1 and l.household_id = $1 and i.item_id = $2`,
    [householdId, itemId],
  );
  const r = res.rows[0];
  return r ? { ...toItem(r), listStatus: r.list_status } : null;
}

/** 行の組み立て結果を、今の行にそろえる。1 つの取引の中で呼ぶこと（BR20.3） */
export async function applyItemChanges(
  q: Queryable,
  householdId: string,
  listId: string,
  changes: {
    insert: (ItemContent & { itemId: string })[];
    /** 同じ lineKey のまま中身を更新する行。resetCheck が true ならチェックも外す（BR20.11） */
    update: { itemId: string; content: ItemContent; resetCheck: boolean }[];
    deleteItemIds: string[];
  },
): Promise<void> {
  for (const itemId of changes.deleteItemIds) {
    await q.query('delete from shopping_items where household_id = $1 and item_id = $2', [
      householdId,
      itemId,
    ]);
  }
  for (const u of changes.update) {
    await q.query(
      `update shopping_items
       set ingredient_name = $3, unit = $4, amount_kind = $5, amount_number = $6::numeric,
           amount_text = $7, source_dish_ids = $8::jsonb,
           checked = case when $9 then false else checked end,
           checked_by = case when $9 then null else checked_by end,
           checked_at = case when $9 then null else checked_at end
       where household_id = $1 and item_id = $2`,
      [
        householdId,
        u.itemId,
        u.content.ingredientName,
        u.content.unit === '' ? null : u.content.unit,
        u.content.amountKind,
        u.content.amountNumber,
        u.content.amountText,
        JSON.stringify(u.content.sourceDishIds),
        u.resetCheck,
      ],
    );
  }
  for (const c of changes.insert) {
    await q.query(
      `insert into shopping_items (item_id, list_id, household_id, line_key, kind, ingredient_name,
                                   unit, amount_kind, amount_number, amount_text, source_dish_ids)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10, $11::jsonb)`,
      [
        c.itemId,
        listId,
        householdId,
        c.lineKey,
        c.kind,
        c.ingredientName,
        c.unit === '' ? null : c.unit,
        c.amountKind,
        c.amountNumber,
        c.amountText,
        JSON.stringify(c.sourceDishIds),
      ],
    );
  }
}

/**
 * 結果の値（付ける / 外す）を指定してチェックを書く。繰り返しても同じ（BR20.10）。
 * 「材料の入力が必要」の行・完了したリストの行・他のグループの行は書かない（false）
 */
export async function writeChecked(
  q: Queryable,
  householdId: string,
  itemId: string,
  v: { checked: boolean; memberId: string; now: Date },
): Promise<boolean> {
  const res = await q.query(
    `update shopping_items i
     set checked = $3,
         checked_by = case when $3 then $4::uuid else null end,
         checked_at = case when $3 then $5::timestamptz else null end
     from shopping_lists l
     where i.household_id = $1 and l.household_id = $1 and l.list_id = i.list_id
       and i.item_id = $2 and i.kind = 'ingredient' and l.status = 'active'`,
    [householdId, itemId, v.checked, v.memberId, v.now],
  );
  return res.rowCount === 1;
}

/**
 * 作成中のリストを完了にする。同時に、外す対象の dishId の一覧を保存する（BR20.13）。
 * すでに完了していたら false（呼び出し側は成功として扱う）
 */
export async function markCompleted(
  q: Queryable,
  householdId: string,
  listId: string,
  v: { memberId: string; now: Date; unpickDishIds: string[]; unpickDone: boolean },
): Promise<boolean> {
  const res = await q.query(
    `update shopping_lists
     set status = 'completed', completed_at = $3, completed_by = $4,
         unpick_dish_ids = $5::jsonb, unpick_done = $6
     where household_id = $1 and list_id = $2 and status = 'active'`,
    [householdId, listId, v.now, v.memberId, JSON.stringify(v.unpickDishIds), v.unpickDone],
  );
  return res.rowCount === 1;
}

/** 外す処理が全部終わった印を付ける（BR20.13） */
export async function markUnpickDone(
  q: Queryable,
  householdId: string,
  listId: string,
): Promise<void> {
  await q.query(
    'update shopping_lists set unpick_done = true where household_id = $1 and list_id = $2',
    [householdId, listId],
  );
}

/** 外し残しのある完了済みのリスト（picked のみ。完了の古い順。BR20.13） */
export async function listPendingUnpick(
  q: Queryable,
  householdId: string,
): Promise<ShoppingListRow[]> {
  const res = await q.query<RawList>(
    `select ${LIST_COLUMNS} from shopping_lists
     where household_id = $1 and source = 'picked' and status = 'completed' and unpick_done = false
     order by completed_at, list_id`,
    [householdId],
  );
  return res.rows.map(toList);
}

/** グループのリストと行をすべて消す（household.deleted。何度呼んでも同じ。BR20.15） */
export async function deleteListsOfHousehold(q: Queryable, householdId: string): Promise<number> {
  // 行はリストの削除で連鎖して消える。念のため行も先に消す
  await q.query('delete from shopping_items where household_id = $1', [householdId]);
  const res = await q.query('delete from shopping_lists where household_id = $1', [householdId]);
  return res.rowCount;
}

/** 行の表示に使う料理名（削除済みも含める。ADR-008）。他のグループの料理は含めない */
export async function getDishNames(
  q: Queryable,
  householdId: string,
  dishIds: string[],
): Promise<Map<string, { name: string; deleted: boolean }>> {
  const out = new Map<string, { name: string; deleted: boolean }>();
  if (dishIds.length === 0) return out;
  const res = await q.query<{ dish_id: string; name: string; deleted_at: Date | null }>(
    `select dish_id, name, deleted_at from dishes
     where household_id = $1 and dish_id = any($2::uuid[])`,
    [householdId, dishIds],
  );
  for (const r of res.rows) out.set(r.dish_id, { name: r.name, deleted: r.deleted_at !== null });
  return out;
}

/** チェック・完了した人の表示名の元（退会後も行は残る。BR20.16）。他のグループのメンバーは含めない */
export async function getMemberLabels(
  q: Queryable,
  householdId: string,
  memberIds: string[],
): Promise<Map<string, { displayName: string | null; leftAt: Date | null }>> {
  const out = new Map<string, { displayName: string | null; leftAt: Date | null }>();
  if (memberIds.length === 0) return out;
  const res = await q.query<{
    member_id: string;
    display_name: string | null;
    left_at: Date | null;
  }>(
    `select member_id, display_name, left_at from members
     where household_id = $1 and member_id = any($2::uuid[])`,
    [householdId, memberIds],
  );
  for (const r of res.rows)
    out.set(r.member_id, { displayName: r.display_name, leftAt: r.left_at });
  return out;
}
