/** API が返す元の料理（src/domain/shopping の ShoppingDishRef と同じ形） */
export interface ShoppingDishDto {
  dishId: string;
  name: string;
  deleted: boolean;
}

/** API が返す行 1 つ（src/domain/shopping の ShoppingItemView と同じ形） */
export interface ShoppingItemDto {
  itemId: string;
  kind: 'ingredient' | 'needsInput';
  ingredientName: string | null;
  unit: string;
  /** 分量の表示（「3」「少々」。空なら空文字）。単位は含まない */
  amountLabel: string;
  dishes: ShoppingDishDto[];
  checked: boolean;
  checkedByLabel: string | null;
  checkedAt: string | null;
}

/** API が返すリスト（src/domain/shopping の ShoppingListView と同じ形） */
export interface ShoppingListDto {
  listId: string;
  source: 'picked' | 'mealPlan';
  planId: string | null;
  status: 'active' | 'completed';
  empty: boolean;
  stale: boolean;
  completedAt: string | null;
  completedByLabel: string | null;
  items: ShoppingItemDto[];
}

export interface CompleteResultDto {
  alreadyCompleted: boolean;
  unpickPending: boolean;
}

/** 材料の行の表示：「玉ねぎ 3個」「塩 少々」「醤油」 */
export function itemText(item: ShoppingItemDto): string {
  const name = item.ingredientName ?? '';
  const amount = `${item.amountLabel}${item.unit}`;
  return amount ? `${name} ${amount}` : name;
}

/** 元の料理の名前（「肉じゃが、カレー」） */
export const dishText = (item: ShoppingItemDto): string =>
  item.dishes.map((d) => d.name).join('、');

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * BR20.9 の並びを、チェックを付け外ししたあとの画面で保つ（サーバーと同じ規則）。
 * 入力が必要な行 → チェックのない行 → チェックのある行。同じ区分の中は、材料名の順、同じ名前なら単位の順。
 * 同じ並びになるものは、受け取った順のまま
 */
export function orderItems(items: ShoppingItemDto[]): ShoppingItemDto[] {
  const group = (i: ShoppingItemDto) => (i.kind === 'needsInput' ? 0 : i.checked ? 2 : 1);
  const name = (i: ShoppingItemDto) =>
    i.kind === 'needsInput' ? (i.dishes[0]?.name ?? '') : (i.ingredientName ?? '');
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        group(a.item) - group(b.item) ||
        byCode(name(a.item), name(b.item)) ||
        byCode(a.item.unit, b.item.unit) ||
        a.index - b.index,
    )
    .map((x) => x.item);
}
