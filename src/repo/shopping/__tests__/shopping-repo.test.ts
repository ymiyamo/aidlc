import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { createDish } from '@/domain/dish';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
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
} from '../index';

let deps: AppDeps;
beforeAll(async () => {
  ({ deps } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

const NOW = new Date('2026-10-10T00:00:00Z');
const id = () => crypto.randomUUID();

async function world(label: string) {
  const u = await registerWithHousehold(deps, label);
  const dish = await createDish(deps, u.ctx, {
    name: `${label}の料理`,
    url: 'https://example.com/a',
  });
  return { ...u, dish };
}

const content = (dishId: string, over: Partial<ItemContent> = {}): ItemContent => ({
  lineKey: JSON.stringify(['n', '玉ねぎ', '個']),
  kind: 'ingredient',
  ingredientName: '玉ねぎ',
  unit: '個',
  amountKind: 'numeric',
  amountNumber: '2',
  amountText: '2',
  sourceDishIds: [dishId],
  ...over,
});

async function listWithItem(w: Awaited<ReturnType<typeof world>>, over: Partial<ItemContent> = {}) {
  const list = await ensureActiveList(
    deps.db,
    w.householdId,
    { source: 'picked' },
    { listId: id(), now: NOW },
  );
  const itemId = id();
  await applyItemChanges(deps.db, w.householdId, list.listId, {
    insert: [{ ...content(w.dish.dishId, over), itemId }],
    update: [],
    deleteItemIds: [],
  });
  return { list, itemId };
}

describe('リポジトリ：リストの作成と取得（BR20.2）', () => {
  it('作成中のリストは 1 件。2 回目は作らず同じものを返す', async () => {
    const w = await world('a');
    const first = await ensureActiveList(
      deps.db,
      w.householdId,
      { source: 'picked' },
      { listId: id(), now: NOW },
    );
    const second = await ensureActiveList(
      deps.db,
      w.householdId,
      { source: 'picked' },
      { listId: id(), now: NOW },
    );
    expect(second.listId).toBe(first.listId);
    expect(first).toMatchObject({ source: 'picked', status: 'active', sourcePlanId: null });
    expect(first.unpickDishIds).toEqual([]);
  });

  it('同時に 2 つの「作る」が来ても 1 件のまま', async () => {
    const w = await world('b');
    const lists = await Promise.all(
      [1, 2, 3].map(() =>
        ensureActiveList(deps.db, w.householdId, { source: 'picked' }, { listId: id(), now: NOW }),
      ),
    );
    expect(new Set(lists.map((l) => l.listId)).size).toBe(1);
  });

  it('献立用のリストは、献立の ID ごとに別。「選んだもの」のリストとも別', async () => {
    const w = await world('c');
    const picked = await ensureActiveList(
      deps.db,
      w.householdId,
      { source: 'picked' },
      { listId: id(), now: NOW },
    );
    const p1 = await ensureActiveList(
      deps.db,
      w.householdId,
      { source: 'mealPlan', planId: 'p1' },
      { listId: id(), now: NOW },
    );
    const p2 = await ensureActiveList(
      deps.db,
      w.householdId,
      { source: 'mealPlan', planId: 'p2' },
      { listId: id(), now: NOW },
    );
    expect(new Set([picked.listId, p1.listId, p2.listId]).size).toBe(3);
    expect(p1.sourcePlanId).toBe('p1');
    expect(
      (await findActiveList(deps.db, w.householdId, { source: 'mealPlan', planId: 'p2' }))?.listId,
    ).toBe(p2.listId);
  });
});

describe('リポジトリ：他のグループが見えない（BR20.1）', () => {
  it('リスト・行・チェック・完了のどれも、他のグループからは届かない', async () => {
    const a = await world('own');
    const b = await world('other');
    const { list, itemId } = await listWithItem(a);

    expect(await getList(deps.db, b.householdId, list.listId)).toBeNull();
    expect(await listItems(deps.db, b.householdId, list.listId)).toEqual([]);
    expect(await getItem(deps.db, b.householdId, itemId)).toBeNull();
    expect(await findActiveList(deps.db, b.householdId, { source: 'picked' })).toBeNull();
    expect(
      await writeChecked(deps.db, b.householdId, itemId, {
        checked: true,
        memberId: b.memberId,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      await markCompleted(deps.db, b.householdId, list.listId, {
        memberId: b.memberId,
        now: NOW,
        unpickDishIds: [],
        unpickDone: true,
      }),
    ).toBe(false);
    // 持ち主からは今までどおり読める
    expect((await listItems(deps.db, a.householdId, list.listId))[0].checked).toBe(false);
    expect((await getList(deps.db, a.householdId, list.listId))?.status).toBe('active');
  });

  it('料理名とメンバーの表示名の元は、自分のグループのものだけ（削除済みの料理も含む）', async () => {
    const a = await world('names-a');
    const b = await world('names-b');
    await deps.db.query('update dishes set deleted_at = now() where dish_id = $1', [a.dish.dishId]);
    const names = await getDishNames(deps.db, a.householdId, [a.dish.dishId, b.dish.dishId]);
    expect(names.get(a.dish.dishId)).toEqual({ name: 'names-aの料理', deleted: true });
    expect(names.has(b.dish.dishId)).toBe(false);
    const labels = await getMemberLabels(deps.db, a.householdId, [a.memberId, b.memberId]);
    expect(labels.get(a.memberId)?.displayName).toBe('names-a');
    expect(labels.has(b.memberId)).toBe(false);
    expect((await getDishNames(deps.db, a.householdId, [])).size).toBe(0);
  });
});

describe('リポジトリ：行の差し替え（1 つの取引。BR20.3）', () => {
  it('追加・更新・削除をまとめて反映する。分量が変わった行はチェックを外せる', async () => {
    const w = await world('apply');
    const { list, itemId } = await listWithItem(w);
    await writeChecked(deps.db, w.householdId, itemId, {
      checked: true,
      memberId: w.memberId,
      now: NOW,
    });
    const salt = id();
    const saltKey = JSON.stringify(['t', '塩', '', '少々', w.dish.dishId]);

    await applyItemChanges(deps.db, w.householdId, list.listId, {
      insert: [
        {
          ...content(w.dish.dishId, {
            lineKey: saltKey,
            ingredientName: '塩',
            unit: '',
            amountKind: 'text',
            amountNumber: null,
            amountText: '少々',
          }),
          itemId: salt,
        },
      ],
      update: [
        {
          itemId,
          content: content(w.dish.dishId, { amountNumber: '3', amountText: '3' }),
          resetCheck: false,
        },
      ],
      deleteItemIds: [],
    });
    let rows = await listItems(deps.db, w.householdId, list.listId);
    expect(rows).toHaveLength(2);
    const onion = rows.find((r) => r.itemId === itemId)!;
    expect(onion).toMatchObject({ amountNumber: '3', checked: true, checkedBy: w.memberId });
    expect(rows.find((r) => r.itemId === salt)).toMatchObject({
      unit: '',
      amountKind: 'text',
      amountText: '少々',
    });

    await applyItemChanges(deps.db, w.householdId, list.listId, {
      insert: [],
      update: [
        {
          itemId,
          content: content(w.dish.dishId, { amountNumber: '4', amountText: '4' }),
          resetCheck: true,
        },
      ],
      deleteItemIds: [salt],
    });
    rows = await listItems(deps.db, w.householdId, list.listId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountNumber: '4',
      checked: false,
      checkedBy: null,
      checkedAt: null,
    });
  });

  it('取引が途中で失敗したら、行は一部だけ変わらない', async () => {
    const w = await world('tx');
    const { list, itemId } = await listWithItem(w);
    await expect(
      deps.db.transaction(async (tx) => {
        await applyItemChanges(tx, w.householdId, list.listId, {
          insert: [],
          update: [],
          deleteItemIds: [itemId],
        });
        throw new Error('途中で失敗');
      }),
    ).rejects.toThrow('途中で失敗');
    expect(await listItems(deps.db, w.householdId, list.listId)).toHaveLength(1);
  });
});

describe('リポジトリ：チェック（BR20.10）', () => {
  it('結果の値を指定して書く。繰り返しても同じで、外すと誰がいつも消える', async () => {
    const w = await world('check');
    const { list, itemId } = await listWithItem(w);
    const call = (checked: boolean) =>
      writeChecked(deps.db, w.householdId, itemId, { checked, memberId: w.memberId, now: NOW });

    expect(await call(true)).toBe(true);
    expect(await call(true)).toBe(true);
    let row = (await listItems(deps.db, w.householdId, list.listId))[0];
    expect(row).toMatchObject({ checked: true, checkedBy: w.memberId });
    expect(row.checkedAt?.toISOString()).toBe(NOW.toISOString());

    expect(await call(false)).toBe(true);
    row = (await listItems(deps.db, w.householdId, list.listId))[0];
    expect(row).toMatchObject({ checked: false, checkedBy: null, checkedAt: null });
  });

  it('「材料の入力が必要」の行と、完了したリストの行には書けない', async () => {
    const w = await world('nocheck');
    const { list, itemId } = await listWithItem(w);
    const needs = id();
    await applyItemChanges(deps.db, w.householdId, list.listId, {
      insert: [
        {
          ...content(w.dish.dishId, {
            lineKey: JSON.stringify(['i', w.dish.dishId]),
            kind: 'needsInput',
            ingredientName: null,
            unit: '',
            amountKind: null,
            amountNumber: null,
            amountText: null,
          }),
          itemId: needs,
        },
      ],
      update: [],
      deleteItemIds: [],
    });
    const v = { checked: true, memberId: w.memberId, now: NOW };
    expect(await writeChecked(deps.db, w.householdId, needs, v)).toBe(false);

    await markCompleted(deps.db, w.householdId, list.listId, {
      memberId: w.memberId,
      now: NOW,
      unpickDishIds: [],
      unpickDone: true,
    });
    expect(await writeChecked(deps.db, w.householdId, itemId, v)).toBe(false);
    expect((await getItem(deps.db, w.householdId, itemId))?.listStatus).toBe('completed');
  });
});

describe('リポジトリ：完了と外し残し（BR20.13）', () => {
  it('完了は 1 回だけ成功し、外す対象を保存する。外し残しの探索と完了の印', async () => {
    const w = await world('done');
    const { list } = await listWithItem(w);
    const v = { memberId: w.memberId, now: NOW, unpickDishIds: [w.dish.dishId], unpickDone: false };
    expect(await markCompleted(deps.db, w.householdId, list.listId, v)).toBe(true);
    expect(await markCompleted(deps.db, w.householdId, list.listId, v)).toBe(false);

    const done = (await getList(deps.db, w.householdId, list.listId))!;
    expect(done).toMatchObject({ status: 'completed', completedBy: w.memberId, unpickDone: false });
    expect(done.unpickDishIds).toEqual([w.dish.dishId]);
    expect(done.completedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await findActiveList(deps.db, w.householdId, { source: 'picked' })).toBeNull();

    expect((await listPendingUnpick(deps.db, w.householdId)).map((l) => l.listId)).toEqual([
      list.listId,
    ]);
    await markUnpickDone(deps.db, w.householdId, list.listId);
    expect(await listPendingUnpick(deps.db, w.householdId)).toEqual([]);
    // 完了後は、新しい作成中のリストを作れる
    const next = await ensureActiveList(
      deps.db,
      w.householdId,
      { source: 'picked' },
      { listId: id(), now: NOW },
    );
    expect(next.listId).not.toBe(list.listId);
  });
});

describe('リポジトリ：グループ削除（BR20.15）', () => {
  it('そのグループのリストと行だけが消える。何度呼んでも同じ', async () => {
    const a = await world('del-a');
    const b = await world('del-b');
    const { list: la } = await listWithItem(a);
    const { list: lb } = await listWithItem(b);

    expect(await deleteListsOfHousehold(deps.db, a.householdId)).toBe(1);
    expect(await deleteListsOfHousehold(deps.db, a.householdId)).toBe(0);
    expect(await getList(deps.db, a.householdId, la.listId)).toBeNull();
    expect(await listItems(deps.db, a.householdId, la.listId)).toEqual([]);
    expect(await listItems(deps.db, b.householdId, lb.listId)).toHaveLength(1);
  });
});
