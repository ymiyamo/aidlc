import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import { createTestDb } from '@/test-helpers/db';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const id = () => crypto.randomUUID();

/** グループ・メンバー・料理 1 件を直接作る */
async function setup() {
  const householdId = id();
  const memberId = id();
  const dishId = id();
  await db.query('insert into households (household_id, name) values ($1,$2)', [householdId, 'g']);
  await db.query('insert into members (member_id, household_id) values ($1,$2)', [
    memberId,
    householdId,
  ]);
  await db.query('insert into dishes (dish_id, household_id, name, url) values ($1,$2,$3,$4)', [
    dishId,
    householdId,
    'A',
    'https://example.com/x',
  ]);
  return { householdId, memberId, dishId };
}

const insertList = (
  householdId: string,
  over: { source?: string; planId?: string | null; status?: string } = {},
) => {
  const status = over.status ?? 'active';
  return db.query(
    `insert into shopping_lists (list_id, household_id, source, source_plan_id, status, completed_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      id(),
      householdId,
      over.source ?? 'picked',
      over.planId ?? null,
      status,
      status === 'completed' ? new Date() : null,
    ],
  );
};

async function listWithId(householdId: string) {
  const listId = id();
  await db.query(
    `insert into shopping_lists (list_id, household_id, source) values ($1,$2,'picked')`,
    [listId, householdId],
  );
  return listId;
}

const insertItem = (
  s: { householdId: string; dishId: string },
  listId: string,
  over: Partial<{
    lineKey: string;
    kind: string;
    name: string | null;
    amountKind: string | null;
    amountNumber: string | null;
    checked: boolean;
    dishIds: string[];
  }> = {},
) =>
  db.query(
    `insert into shopping_items (item_id, list_id, household_id, line_key, kind, ingredient_name,
                                 amount_kind, amount_number, source_dish_ids, checked)
     values ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::jsonb,$10)`,
    [
      id(),
      listId,
      s.householdId,
      over.lineKey ?? id(),
      over.kind ?? 'ingredient',
      over.name === undefined ? '玉ねぎ' : over.name,
      over.amountKind === undefined ? 'numeric' : over.amountKind,
      over.amountNumber === undefined ? '2' : over.amountNumber,
      JSON.stringify(over.dishIds ?? [s.dishId]),
      over.checked ?? false,
    ],
  );

describe('003 移行：shopping_lists（BR20.2、BR20.14）', () => {
  it('同じグループの「選んだもの」の作成中のリストは 1 件まで。完了後は新しく作れる', async () => {
    const s = await setup();
    await insertList(s.householdId);
    await expect(insertList(s.householdId)).rejects.toThrow();
    // 完了済みは何件あってもよい
    await insertList(s.householdId, { status: 'completed' });
    await insertList(s.householdId, { status: 'completed' });
    // 別のグループは別
    const other = await setup();
    await expect(insertList(other.householdId)).resolves.toBeDefined();
  });

  it('献立用のリストは、献立の ID ごとに作成中を 1 件まで。「選んだもの」のリストとは別に持てる', async () => {
    const s = await setup();
    await insertList(s.householdId, { source: 'mealPlan', planId: 'plan-1' });
    await expect(
      insertList(s.householdId, { source: 'mealPlan', planId: 'plan-1' }),
    ).rejects.toThrow();
    await expect(
      insertList(s.householdId, { source: 'mealPlan', planId: 'plan-2' }),
    ).resolves.toBeDefined();
    await expect(insertList(s.householdId)).resolves.toBeDefined();
  });

  it('source と status の値、献立の ID と source の対応、完了の時刻の制約', async () => {
    const s = await setup();
    await expect(insertList(s.householdId, { source: 'other' })).rejects.toThrow();
    await expect(insertList(s.householdId, { status: 'open' })).rejects.toThrow();
    // mealPlan なのに献立の ID がない／picked なのに献立の ID がある
    await expect(insertList(s.householdId, { source: 'mealPlan' })).rejects.toThrow();
    await expect(insertList(s.householdId, { planId: 'plan-x' })).rejects.toThrow();
    // 完了なのに completed_at がない
    await expect(
      db.query(
        `insert into shopping_lists (list_id, household_id, source, status) values ($1,$2,'picked','completed')`,
        [id(), s.householdId],
      ),
    ).rejects.toThrow();
  });

  it('存在しないグループは指せない', async () => {
    await expect(insertList(id())).rejects.toThrow();
  });
});

describe('003 移行：shopping_items（BR20.5〜BR20.8）', () => {
  it('同じリストの中で lineKey は一意。別のリストなら同じ lineKey を持てる', async () => {
    const s = await setup();
    const listA = await listWithId(s.householdId);
    await insertItem(s, listA, { lineKey: 'k1' });
    await expect(insertItem(s, listA, { lineKey: 'k1' })).rejects.toThrow();
    await db.query(
      'update shopping_lists set status = $2, completed_at = now() where list_id = $1',
      [listA, 'completed'],
    );
    const listB = await listWithId(s.householdId);
    await expect(insertItem(s, listB, { lineKey: 'k1' })).resolves.toBeDefined();
  });

  it('分量の種類と数の対応：numeric は 0 より大きい数が必須、それ以外は数を持たない', async () => {
    const s = await setup();
    const listId = await listWithId(s.householdId);
    await insertItem(s, listId, { amountKind: 'numeric', amountNumber: '0.333333' });
    await expect(
      insertItem(s, listId, { amountKind: 'numeric', amountNumber: null }),
    ).rejects.toThrow();
    await expect(
      insertItem(s, listId, { amountKind: 'numeric', amountNumber: '0' }),
    ).rejects.toThrow();
    await expect(
      insertItem(s, listId, { amountKind: 'text', amountNumber: '1' }),
    ).rejects.toThrow();
    await expect(
      insertItem(s, listId, { amountKind: 'none', amountNumber: null }),
    ).resolves.toBeDefined();
    await expect(
      insertItem(s, listId, { amountKind: 'bad', amountNumber: null }),
    ).rejects.toThrow();
  });

  it('材料の行は材料名が必須。「材料の入力が必要」の行はチェックできず、料理は 1 件', async () => {
    const s = await setup();
    const listId = await listWithId(s.householdId);
    await expect(insertItem(s, listId, { name: null })).rejects.toThrow();
    const needs = { kind: 'needsInput', name: null, amountKind: null, amountNumber: null };
    await expect(insertItem(s, listId, needs)).resolves.toBeDefined();
    await expect(insertItem(s, listId, { ...needs, checked: true })).rejects.toThrow();
    await expect(insertItem(s, listId, { ...needs, dishIds: [s.dishId, id()] })).rejects.toThrow();
  });

  it('元の料理は 1 件以上の配列', async () => {
    const s = await setup();
    const listId = await listWithId(s.householdId);
    await expect(insertItem(s, listId, { dishIds: [] })).rejects.toThrow();
  });

  it('リストを消すと行も消える（BR20.15）', async () => {
    const s = await setup();
    const listId = await listWithId(s.householdId);
    await insertItem(s, listId);
    await insertItem(s, listId);
    await db.query('delete from shopping_lists where list_id = $1', [listId]);
    const r = await db.query('select 1 from shopping_items where list_id = $1', [listId]);
    expect(r.rowCount).toBe(0);
  });

  it('料理が論理削除されても行は残る（ADR-008）', async () => {
    const s = await setup();
    const listId = await listWithId(s.householdId);
    await insertItem(s, listId);
    await db.query('update dishes set deleted_at = now() where dish_id = $1', [s.dishId]);
    const r = await db.query('select 1 from shopping_items where list_id = $1', [listId]);
    expect(r.rowCount).toBe(1);
  });
});
