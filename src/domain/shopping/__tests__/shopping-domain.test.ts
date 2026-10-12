import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { createDish, editDish, removeDish } from '@/domain/dish';
import { DomainError } from '@/domain/errors';
import { pick, pickedList, unpick } from '@/domain/suggestion';
import { getList } from '@/repo/shopping';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import {
  completeMealPlanList,
  completeShoppingList,
  composeFromIngredients,
  DELETED_DISH_LABEL,
  ensureShoppingHandlers,
  getMealPlanList,
  openShoppingList,
  setItemChecked,
  type ShoppingItemView,
} from '../index';

let deps: AppDeps;
let clock: TestClock;
beforeAll(async () => {
  ({ deps, clock } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

type Ing = [string, string | null, string | null];
let seq = 0;

/** ログイン済みでグループもある世界。料理は材料つきで作る */
async function world(label: string) {
  const h = await registerWithHousehold(deps, label);
  const dish = async (name: string, ings: Ing[]) =>
    createDish(deps, h.ctx, {
      name,
      url: `https://example.com/${label}/${(seq += 1)}`,
      ingredients: ings.map(([n, amount, unit]) => ({ name: n, amount, unit })),
    });
  const select = async (name: string, ings: Ing[]) => {
    const d = await dish(name, ings);
    await pick(deps, h.ctx, d.dishId);
    return d;
  };
  return { ...h, dish, select };
}
type World = Awaited<ReturnType<typeof world>>;

const find = (items: ShoppingItemView[], name: string, unit = '') =>
  items.find((i) => i.ingredientName === name && i.unit === unit);
const label = (i: ShoppingItemView) =>
  `${i.ingredientName}${i.amountLabel ? ` ${i.amountLabel}` : ''}${i.unit}`;

/** 次の 1 回だけ、SQL に当たる問い合わせを失敗させる（失敗時の動きを試す） */
function failQuery(pattern: RegExp, times = 1) {
  const original = deps.db.query;
  let left = times;
  deps.db.query = (async (sql: string, params?: unknown[]) => {
    if (left > 0 && pattern.test(sql)) {
      left -= 1;
      throw new Error('試験用の失敗');
    }
    return original.call(deps.db, sql, params);
  }) as typeof deps.db.query;
  return () => {
    deps.db.query = original;
  };
}

async function secondMember(w: World) {
  const memberId = crypto.randomUUID();
  await deps.db.query(
    'insert into members (member_id, household_id, display_name) values ($1,$2,$3)',
    [memberId, w.householdId, 'はなこ'],
  );
  return { householdId: w.householdId, memberId };
}

describe('リストを開く：作成と集計（BR20.2〜BR20.4、US3.1）', () => {
  it('選んだものが 0 件なら、作成中の空のリストを返す（BR20.12）', async () => {
    const w = await world('empty');
    const list = await openShoppingList(deps, w.ctx);
    expect(list).toMatchObject({
      source: 'picked',
      status: 'active',
      empty: true,
      stale: false,
      items: [],
    });
  });

  it('選んだ料理の材料が 1 つのリストにまとまる（合算・単位違い・数でない分量）', async () => {
    const w = await world('agg');
    const a = await w.select('肉じゃが', [
      ['玉ねぎ', '2', '個'],
      ['塩', '少々', null],
      ['醤油', null, null],
    ]);
    const b = await w.select('カレー', [
      ['玉ねぎ', '1', '個'],
      ['玉ねぎ', '200', 'g'],
      ['塩', '少々', null],
    ]);
    const list = await openShoppingList(deps, w.ctx);

    expect(list.empty).toBe(false);
    const onion = find(list.items, '玉ねぎ', '個')!;
    expect(label(onion)).toBe('玉ねぎ 3個');
    expect(onion.dishes.map((d) => d.name).sort()).toEqual(['カレー', '肉じゃが']);
    expect(label(find(list.items, '玉ねぎ', 'g')!)).toBe('玉ねぎ 200g');
    const salts = list.items.filter((i) => i.ingredientName === '塩');
    expect(salts).toHaveLength(2);
    expect(salts.map((s) => s.dishes[0].dishId).sort()).toEqual([a.dishId, b.dishId].sort());
    expect(find(list.items, '醤油')).toMatchObject({
      amountLabel: '',
      dishes: [{ dishId: a.dishId }],
    });
    expect(list.items).toHaveLength(5);
  });

  it('材料が 0 行の料理は「材料の入力が必要」の行になり、チェックできない。入力すると材料の行になる（BR20.8）', async () => {
    const w = await world('needs');
    const d = await w.select('冷奴', []);
    const list = await openShoppingList(deps, w.ctx);
    expect(list.empty).toBe(false);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      kind: 'needsInput',
      ingredientName: null,
      dishes: [{ name: '冷奴' }],
    });

    await expect(setItemChecked(deps, w.ctx, list.items[0].itemId, true)).rejects.toMatchObject({
      code: 'conflict',
      message: 'チェックできません',
    });

    await editDish(deps, w.ctx, d.dishId, {
      name: '冷奴',
      url: d.url,
      ingredients: [{ name: '豆腐', amount: '1', unit: '丁' }],
    });
    const after = await openShoppingList(deps, w.ctx);
    expect(after.items.map((i) => [i.kind, label(i)])).toEqual([['ingredient', '豆腐 1丁']]);
  });

  it('開くたびに同じリストを返し、何度開いても結果は同じ（冪等。BR20.2）', async () => {
    const w = await world('idem');
    await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    const first = await openShoppingList(deps, w.ctx);
    const second = await openShoppingList(deps, w.ctx);
    expect(second.listId).toBe(first.listId);
    expect(second.items).toEqual(first.items);
    const racing = await Promise.all([1, 2, 3].map(() => openShoppingList(deps, w.ctx)));
    expect(new Set(racing.map((l) => l.listId))).toEqual(new Set([first.listId]));
    expect(racing.every((l) => l.items.length === 1)).toBe(true);
  });

  it('選び直すと、次に開いたとき材料が足され・外れる（US2.6）', async () => {
    const w = await world('repick');
    const a = await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    await openShoppingList(deps, w.ctx);
    await w.select('カレー', [['人参', '1', '本']]);
    let list = await openShoppingList(deps, w.ctx);
    expect(list.items.map(label).sort()).toEqual(['人参 1本', '玉ねぎ 2個']);
    await unpick(deps, w.ctx, a.dishId);
    list = await openShoppingList(deps, w.ctx);
    expect(list.items.map(label)).toEqual(['人参 1本']);
  });

  it('削除した料理の材料は外れ、グループの外の選んだものは入らない', async () => {
    const w = await world('del');
    const other = await world('del-other');
    await other.select('他の家の料理', [['ねぎ', '1', '本']]);
    const d = await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    expect((await openShoppingList(deps, w.ctx)).items).toHaveLength(1);
    await removeDish(deps, w.ctx, d.dishId);
    const list = await openShoppingList(deps, w.ctx);
    expect(list).toMatchObject({ empty: true, items: [] });
  });

  it('並び順：入力が必要な行 → チェックのない行 → チェックのある行。中は材料名の順（BR20.9）', async () => {
    const w = await world('order');
    await w.select('冷奴', []);
    await w.select('サラダ', [
      ['レタス', '1', '玉'],
      ['トマト', '2', '個'],
      ['きゅうり', '1', '本'],
    ]);
    const list = await openShoppingList(deps, w.ctx);
    expect(list.items.map((i) => i.ingredientName)).toEqual([null, 'きゅうり', 'トマト', 'レタス']);
    await setItemChecked(deps, w.ctx, find(list.items, 'きゅうり', '本')!.itemId, true);
    const after = await openShoppingList(deps, w.ctx);
    expect(after.items.map((i) => i.ingredientName)).toEqual([
      null,
      'トマト',
      'レタス',
      'きゅうり',
    ]);
  });

  it('他のグループの選んだものやリストは見えない（BR20.1）', async () => {
    const a = await world('iso-a');
    const b = await world('iso-b');
    await a.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    const la = await openShoppingList(deps, a.ctx);
    const lb = await openShoppingList(deps, b.ctx);
    expect(lb.listId).not.toBe(la.listId);
    expect(lb.items).toEqual([]);
  });

  it('同期できなかったときは、前回保存した内容を stale 付きで返す。保存がなければ失敗を返す（BR20.3）', async () => {
    const w = await world('stale');
    await expect(
      (async () => {
        const restore = failQuery(/from picked_items p join dishes/, 2);
        try {
          return await openShoppingList(deps, w.ctx);
        } finally {
          restore();
        }
      })(),
    ).rejects.toThrow('試験用の失敗');

    await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    const saved = await openShoppingList(deps, w.ctx);
    const restore = failQuery(/from picked_items p join dishes/, 2);
    try {
      const list = await openShoppingList(deps, w.ctx);
      expect(list.stale).toBe(true);
      expect(list.items).toEqual(saved.items);
    } finally {
      restore();
    }
    expect((await openShoppingList(deps, w.ctx)).stale).toBe(false);
  });
});

describe('チェック（BR20.10、BR20.11、US3.2）', () => {
  it('付ける・外すは結果の値を指定する。繰り返しても同じで、別のメンバーが開いても残る', async () => {
    const w = await world('check');
    await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    const list = await openShoppingList(deps, w.ctx);
    const itemId = list.items[0].itemId;

    const on = await setItemChecked(deps, w.ctx, itemId, true);
    expect(on).toMatchObject({ checked: true, checkedByLabel: 'check' });
    expect(on.checkedAt).not.toBeNull();
    await setItemChecked(deps, w.ctx, itemId, true);

    const hanako = await secondMember(w);
    const seen = await openShoppingList(deps, hanako);
    expect(seen.items[0]).toMatchObject({ itemId, checked: true, checkedByLabel: 'check' });
    const byHanako = await setItemChecked(deps, hanako, itemId, true);
    expect(byHanako.checkedByLabel).toBe('はなこ');

    const off = await setItemChecked(deps, hanako, itemId, false);
    expect(off).toMatchObject({ checked: false, checkedByLabel: null, checkedAt: null });
    expect((await openShoppingList(deps, w.ctx)).items[0].checked).toBe(false);
  });

  it('同じ行は同期後もチェックを引き継ぐ。分量が変わった行はチェックが外れる（Q4 A）', async () => {
    const w = await world('carry');
    await w.select('肉じゃが', [
      ['玉ねぎ', '2', '個'],
      ['塩', '少々', null],
    ]);
    const first = await openShoppingList(deps, w.ctx);
    for (const i of first.items) await setItemChecked(deps, w.ctx, i.itemId, true);

    // 別の料理を足す：玉ねぎは 2 → 3 に変わる。塩（肉じゃが）は変わらない
    await w.select('カレー', [['玉ねぎ', '1', '個']]);
    const after = await openShoppingList(deps, w.ctx);
    const onion = find(after.items, '玉ねぎ', '個')!;
    expect(label(onion)).toBe('玉ねぎ 3個');
    expect(onion.checked).toBe(false);
    expect(onion.checkedByLabel).toBeNull();
    expect(find(after.items, '塩')).toMatchObject({
      checked: true,
      itemId: find(first.items, '塩')!.itemId,
    });
  });

  it('分量が同じで元の料理だけが変わったときは、チェックを引き継ぐ', async () => {
    const w = await world('swap');
    const soup = await w.select('オニオンスープ', [['玉ねぎ', '2', '個']]);
    const first = find((await openShoppingList(deps, w.ctx)).items, '玉ねぎ', '個')!;
    await setItemChecked(deps, w.ctx, first.itemId, true);

    await unpick(deps, w.ctx, soup.dishId);
    await w.select('グラタン', [['玉ねぎ', '2', '個']]);
    const same = find((await openShoppingList(deps, w.ctx)).items, '玉ねぎ', '個')!;
    expect(same).toMatchObject({ checked: true, itemId: first.itemId });
    expect(same.dishes.map((d) => d.name)).toEqual(['グラタン']);
  });

  it('外れて戻った行は新しい行で、チェックは外れている', async () => {
    const w = await world('back');
    const d = await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    const list = await openShoppingList(deps, w.ctx);
    await setItemChecked(deps, w.ctx, list.items[0].itemId, true);
    await unpick(deps, w.ctx, d.dishId);
    await openShoppingList(deps, w.ctx);
    await pick(deps, w.ctx, d.dishId);
    const back = await openShoppingList(deps, w.ctx);
    expect(back.items[0].checked).toBe(false);
    expect(back.items[0].itemId).not.toBe(list.items[0].itemId);
  });

  it('異常系：他のグループの行・不正な ID・真偽値でない指定は拒否される', async () => {
    const a = await world('chk-a');
    const b = await world('chk-b');
    await a.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    const itemId = (await openShoppingList(deps, a.ctx)).items[0].itemId;

    await expect(setItemChecked(deps, b.ctx, itemId, true)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(setItemChecked(deps, a.ctx, 'not-a-uuid', true)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(setItemChecked(deps, a.ctx, crypto.randomUUID(), true)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(setItemChecked(deps, a.ctx, itemId, 'yes')).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(setItemChecked(deps, a.ctx, itemId, undefined)).rejects.toBeInstanceOf(
      DomainError,
    );
    expect((await openShoppingList(deps, a.ctx)).items[0].checked).toBe(false);
  });
});

describe('「買い物おわり」（BR20.13、US3.2）', () => {
  it('リストが完了になり、リストの料理の「選んだもの」が外れる。完了後は新しい作成中のリストが始まる', async () => {
    const w = await world('done');
    const a = await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    await w.select('カレー', [['人参', '1', '本']]);
    const list = await openShoppingList(deps, w.ctx);
    // チェックがすべて付いていなくても完了できる
    await setItemChecked(deps, w.ctx, list.items[0].itemId, true);

    expect(await completeShoppingList(deps, w.ctx)).toEqual({
      alreadyCompleted: false,
      unpickPending: false,
    });
    expect(await pickedList(deps, w.ctx)).toEqual([]);

    const done = (await getList(deps.db, w.householdId, list.listId))!;
    expect(done).toMatchObject({ status: 'completed', completedBy: w.memberId, unpickDone: true });
    expect(done.unpickDishIds).toHaveLength(2);
    expect(done.unpickDishIds).toContain(a.dishId);

    const next = await openShoppingList(deps, w.ctx);
    expect(next.listId).not.toBe(list.listId);
    expect(next).toMatchObject({ status: 'active', empty: true });
    // 完了したリストの行は履歴として残り、チェックは変えられない
    await expect(setItemChecked(deps, w.ctx, list.items[0].itemId, false)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('完了の直前に選んだものにそろえる（開いたあとに選んだ料理も外れる）', async () => {
    const w = await world('latest');
    await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    await openShoppingList(deps, w.ctx);
    await w.select('カレー', [['人参', '1', '本']]); // 開いたあとに選ぶ
    await completeShoppingList(deps, w.ctx);
    expect(await pickedList(deps, w.ctx)).toEqual([]);
  });

  it('繰り返しても結果は同じ。作成中のリストがなければ、完了済みとして成功を返す', async () => {
    const w = await world('twice');
    expect(await completeShoppingList(deps, w.ctx)).toEqual({
      alreadyCompleted: true,
      unpickPending: false,
    });
    await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    await openShoppingList(deps, w.ctx);
    expect((await completeShoppingList(deps, w.ctx)).alreadyCompleted).toBe(false);
    expect(await completeShoppingList(deps, w.ctx)).toEqual({
      alreadyCompleted: true,
      unpickPending: false,
    });
  });

  it('完了後に選び直したものは新しいリストに入る', async () => {
    const w = await world('after');
    const a = await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    await openShoppingList(deps, w.ctx);
    await completeShoppingList(deps, w.ctx);
    clock.advanceMs(1000);
    await pick(deps, w.ctx, a.dishId);
    const next = await openShoppingList(deps, w.ctx);
    expect(next.items.map(label)).toEqual(['玉ねぎ 2個']);
  });

  it('外せなかった分は完了を取り消さず、次に開くときに同期より先にやり直す', async () => {
    const w = await world('retry');
    const a = await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    const b = await w.select('カレー', [['人参', '1', '本']]);
    const list = await openShoppingList(deps, w.ctx);

    const restore = failQuery(/delete from picked_items/);
    let result;
    try {
      result = await completeShoppingList(deps, w.ctx);
    } finally {
      restore();
    }
    expect(result).toEqual({ alreadyCompleted: false, unpickPending: true });
    const half = (await getList(deps.db, w.householdId, list.listId))!;
    expect(half).toMatchObject({ status: 'completed', unpickDone: false });
    expect(half.unpickDishIds.sort()).toEqual([a.dishId, b.dishId].sort());
    expect((await pickedList(deps, w.ctx)).length).toBe(2);

    // 開くと、先にやり直してから同期する。新しい作成中のリストに、外し残しの料理は入らない
    const next = await openShoppingList(deps, w.ctx);
    expect(next).toMatchObject({ empty: true, items: [] });
    expect(await pickedList(deps, w.ctx)).toEqual([]);
    expect((await getList(deps.db, w.householdId, list.listId))?.unpickDone).toBe(true);
  });

  it('やり直しで外すのは完了時刻以前から選ばれていたものだけ（完了後の選び直しは外さない）', async () => {
    const w = await world('guard');
    const a = await w.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    const b = await w.select('カレー', [['人参', '1', '本']]);
    const list = await openShoppingList(deps, w.ctx);
    const restore = failQuery(/delete from picked_items/, 2);
    try {
      expect((await completeShoppingList(deps, w.ctx)).unpickPending).toBe(true);
    } finally {
      restore();
    }
    // 肉じゃがは外し、完了後にカレーを選び直した（pickedAt が完了より後）
    await unpick(deps, w.ctx, b.dishId);
    clock.advanceMs(5000);
    await pick(deps, w.ctx, b.dishId);

    const next = await openShoppingList(deps, w.ctx);
    expect((await pickedList(deps, w.ctx)).map((p) => p.dish.dishId)).toEqual([b.dishId]);
    expect(next.items.map(label)).toEqual(['人参 1本']);
    expect((await getList(deps.db, w.householdId, list.listId))?.unpickDone).toBe(true);
    expect(a.dishId).not.toBe(b.dishId);
  });

  it('他のグループの「選んだもの」は外れない', async () => {
    const a = await world('own-done');
    const b = await world('other-done');
    const kept = await b.select('他の家の料理', [['ねぎ', '1', '本']]);
    await a.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    await openShoppingList(deps, a.ctx);
    await completeShoppingList(deps, a.ctx);
    expect((await pickedList(deps, b.ctx)).map((p) => p.dish.dishId)).toEqual([kept.dishId]);
  });
});

describe('献立（U4）から材料を受け取る（BR20.14、ADR-010）', () => {
  it('渡された材料から、「選んだもの」とは別のリストを作る。選んだものには触れない', async () => {
    const w = await world('plan');
    const picked = await w.select('選んだ料理', [['ねぎ', '1', '本']]);
    const a = await w.dish('肉じゃが', []);
    const b = await w.dish('カレー', []);
    const list = await composeFromIngredients(deps, w.ctx, {
      planId: 'plan-1',
      dishes: [
        {
          dishId: a.dishId,
          ingredients: [
            { name: '玉ねぎ', amount: '2', unit: '個' },
            { name: '塩', amount: '少々' },
          ],
        },
        {
          dishId: b.dishId,
          ingredients: [
            { name: '玉ねぎ', amount: '1', unit: '個' },
            { name: '塩', amount: '少々' },
          ],
        },
      ],
    });
    expect(list).toMatchObject({
      source: 'mealPlan',
      planId: 'plan-1',
      status: 'active',
      empty: false,
    });
    expect(list.items.map(label).sort()).toEqual(['塩 少々', '塩 少々', '玉ねぎ 3個']);

    expect((await pickedList(deps, w.ctx)).map((p) => p.dish.dishId)).toEqual([picked.dishId]);
    const own = await openShoppingList(deps, w.ctx);
    expect(own.listId).not.toBe(list.listId);
    expect(own.items.map(label)).toEqual(['ねぎ 1本']);
    expect((await getMealPlanList(deps, w.ctx, 'plan-1'))?.listId).toBe(list.listId);
    expect(await getMealPlanList(deps, w.ctx, 'plan-x')).toBeNull();
  });

  it('同じ献立をもう一度渡すと中身を置き換え、チェックを引き継ぐ。分量が変わった行は外れる', async () => {
    const w = await world('plan2');
    const a = await w.dish('肉じゃが', []);
    const b = await w.dish('カレー', []);
    const give = (
      dishes: { dishId: string; ingredients: { name: string; amount: string; unit: string }[] }[],
    ) => composeFromIngredients(deps, w.ctx, { planId: 'plan-2', dishes });
    const onion = (n: string) => ({ name: '玉ねぎ', amount: n, unit: '個' });
    const carrot = { name: '人参', amount: '1', unit: '本' };

    const first = await give([{ dishId: a.dishId, ingredients: [onion('2'), carrot] }]);
    for (const i of first.items) await setItemChecked(deps, w.ctx, i.itemId, true);

    const second = await give([
      { dishId: a.dishId, ingredients: [onion('2'), carrot] },
      { dishId: b.dishId, ingredients: [onion('1')] },
    ]);
    expect(second.listId).toBe(first.listId);
    expect(find(second.items, '人参', '本')?.checked).toBe(true);
    expect(find(second.items, '玉ねぎ', '個')).toMatchObject({ checked: false, amountLabel: '3' });

    const third = await give([{ dishId: b.dishId, ingredients: [onion('1')] }]);
    expect(third.items.map(label)).toEqual(['玉ねぎ 1個']);
  });

  it('材料が空なら空のリスト。料理に材料がなければ「材料の入力が必要」の行', async () => {
    const w = await world('plan3');
    const d = await w.dish('冷奴', []);
    expect(
      await composeFromIngredients(deps, w.ctx, { planId: 'plan-3', dishes: [] }),
    ).toMatchObject({
      empty: true,
      items: [],
    });
    const list = await composeFromIngredients(deps, w.ctx, {
      planId: 'plan-3',
      dishes: [{ dishId: d.dishId, ingredients: [] }],
    });
    expect(list.items).toMatchObject([{ kind: 'needsInput', dishes: [{ name: '冷奴' }] }]);
  });

  it('完了しても「選んだもの」は外れない。完了後は同じ献立でも新しいリストになる', async () => {
    const w = await world('plan4');
    const picked = await w.select('選んだ料理', [['ねぎ', '1', '本']]);
    const d = await w.dish('肉じゃが', []);
    const input = {
      planId: 'plan-4',
      dishes: [{ dishId: d.dishId, ingredients: [{ name: '玉ねぎ', amount: '1' }] }],
    };
    const first = await composeFromIngredients(deps, w.ctx, input);
    expect(await completeMealPlanList(deps, w.ctx, 'plan-4')).toEqual({
      alreadyCompleted: false,
      unpickPending: false,
    });
    expect(await completeMealPlanList(deps, w.ctx, 'plan-4')).toEqual({
      alreadyCompleted: true,
      unpickPending: false,
    });
    expect((await pickedList(deps, w.ctx)).map((p) => p.dish.dishId)).toEqual([picked.dishId]);
    const second = await composeFromIngredients(deps, w.ctx, input);
    expect(second.listId).not.toBe(first.listId);
  });

  it('別のグループの献立の ID でも、そのグループのリストにしか届かない。不正な入力は拒否される', async () => {
    const a = await world('plan-a');
    const b = await world('plan-b');
    const da = await a.dish('肉じゃが', []);
    const db_ = await b.dish('カレー', []);
    const la = await composeFromIngredients(deps, a.ctx, {
      planId: 'same',
      dishes: [{ dishId: da.dishId, ingredients: [{ name: '玉ねぎ', amount: '1' }] }],
    });
    const lb = await composeFromIngredients(deps, b.ctx, {
      planId: 'same',
      dishes: [{ dishId: db_.dishId, ingredients: [{ name: '人参', amount: '1' }] }],
    });
    expect(lb.listId).not.toBe(la.listId);
    expect(lb.items.map(label)).toEqual(['人参 1']);
    expect(await getMealPlanList(deps, a.ctx, 'same')).toMatchObject({ listId: la.listId });

    const bad = [
      { planId: '', dishes: [] },
      { planId: 'p', dishes: [{ dishId: 'x', ingredients: [] }] },
      { planId: 'p', dishes: [{ dishId: da.dishId, ingredients: [{ name: '', amount: '1' }] }] },
    ];
    for (const input of bad) {
      await expect(composeFromIngredients(deps, a.ctx, input)).rejects.toMatchObject({
        code: 'validation',
      });
    }
  });
});

describe('グループ削除の受け口（BR20.15、ADR-007）', () => {
  it('household.deleted を受けると、そのグループのリストと行が消える。何度受けても同じ', async () => {
    const a = await world('gone-a');
    const b = await world('gone-b');
    await a.select('肉じゃが', [['玉ねぎ', '2', '個']]);
    await b.select('カレー', [['人参', '1', '本']]);
    const la = await openShoppingList(deps, a.ctx);
    const lb = await openShoppingList(deps, b.ctx);
    ensureShoppingHandlers(deps);
    ensureShoppingHandlers(deps); // 2 回呼んでも登録は 1 回

    const event = { eventId: crypto.randomUUID(), householdId: a.householdId };
    await deps.events.publish('household.deleted', event);
    await deps.events.publish('household.deleted', event);

    expect(await getList(deps.db, a.householdId, la.listId)).toBeNull();
    const rest = await deps.db.query('select 1 from shopping_items where household_id = $1', [
      a.householdId,
    ]);
    expect(rest.rowCount).toBe(0);
    expect(await getList(deps.db, b.householdId, lb.listId)).not.toBeNull();
    expect(DELETED_DISH_LABEL).toBe('削除された料理');
  });
});
