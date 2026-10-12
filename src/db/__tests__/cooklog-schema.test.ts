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

/** グループ・メンバー・料理 2 件を直接作る */
async function setup() {
  const householdId = id();
  const memberId = id();
  const dishA = id();
  const dishB = id();
  await db.query('insert into households (household_id, name) values ($1,$2)', [householdId, 'g']);
  await db.query('insert into members (member_id, household_id) values ($1,$2)', [
    memberId,
    householdId,
  ]);
  for (const [dishId, name] of [
    [dishA, 'A'],
    [dishB, 'B'],
  ]) {
    await db.query('insert into dishes (dish_id, household_id, name, url) values ($1,$2,$3,$4)', [
      dishId,
      householdId,
      name,
      'https://example.com/x',
    ]);
  }
  return { householdId, memberId, dishA, dishB };
}

const insert = (
  s: { householdId: string; memberId: string },
  dishId: string,
  cookedOn: string,
  extra: { impression?: string | null; memo?: string | null } = {},
) =>
  db.query(
    `insert into cook_records (record_id, household_id, dish_id, member_id, cooked_on, impression, caution_memo)
     values ($1,$2,$3,$4,$5::date,$6,$7)`,
    [
      id(),
      s.householdId,
      dishId,
      s.memberId,
      cookedOn,
      extra.impression ?? null,
      extra.memo ?? null,
    ],
  );

describe('005 移行：cook_records（BR40.x）', () => {
  it('同じ料理に、別の日の記録を何件でも持てる（1 対多）', async () => {
    const s = await setup();
    await insert(s, s.dishA, '2026-10-01');
    await insert(s, s.dishA, '2026-10-02');
    await insert(s, s.dishA, '2026-10-03');
    const r = await db.query<{ n: string }>(
      'select count(*) as n from cook_records where dish_id = $1',
      [s.dishA],
    );
    expect(Number(r.rows[0].n)).toBe(3);
  });

  it('同じ料理の同じ日は 2 件目を作れない（BR40.4）。違う料理なら同じ日に作れる', async () => {
    const s = await setup();
    await insert(s, s.dishA, '2026-10-01');
    await expect(insert(s, s.dishA, '2026-10-01')).rejects.toThrow();
    await expect(insert(s, s.dishB, '2026-10-01')).resolves.toBeDefined();
  });

  it('感想は 2 択か空だけ（BR40.2）', async () => {
    const s = await setup();
    await insert(s, s.dishA, '2026-10-01', { impression: 'again' });
    await insert(s, s.dishA, '2026-10-02', { impression: 'never_again' });
    await insert(s, s.dishA, '2026-10-03', { impression: null });
    await expect(insert(s, s.dishA, '2026-10-04', { impression: 'maybe' })).rejects.toThrow();
  });

  it('メモは 1000 文字まで（BR40.3）', async () => {
    const s = await setup();
    await insert(s, s.dishA, '2026-10-01', { memo: 'あ'.repeat(1000) });
    await expect(insert(s, s.dishA, '2026-10-02', { memo: 'あ'.repeat(1001) })).rejects.toThrow();
  });

  it('存在しない料理・メンバーは指せない', async () => {
    const s = await setup();
    await expect(insert(s, id(), '2026-10-01')).rejects.toThrow();
    await expect(insert({ ...s, memberId: id() }, s.dishA, '2026-10-01')).rejects.toThrow();
  });

  it('料理が論理削除されても記録は残る（BR40.11）', async () => {
    const s = await setup();
    await insert(s, s.dishA, '2026-10-01');
    await db.query('update dishes set deleted_at = now() where dish_id = $1', [s.dishA]);
    const r = await db.query('select 1 from cook_records where dish_id = $1', [s.dishA]);
    expect(r.rowCount).toBe(1);
  });
});
