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

/** グループ・メンバー 2 人を直接作る */
async function setup() {
  const householdId = id();
  const memberA = id();
  const memberB = id();
  await db.query('insert into households (household_id, name) values ($1,$2)', [householdId, 'g']);
  for (const m of [memberA, memberB]) {
    await db.query('insert into members (member_id, household_id) values ($1,$2)', [
      m,
      householdId,
    ]);
  }
  return { householdId, memberA, memberB };
}

const insert = (householdId: string, memberId: string, name: string) =>
  db.query(
    `insert into disliked_ingredients (dislike_id, household_id, member_id, ingredient_name)
     values ($1,$2,$3,$4)`,
    [id(), householdId, memberId, name],
  );

describe('002 移行：disliked_ingredients（BR10.x）', () => {
  it('1 人が、別の食材を何件でも登録できる', async () => {
    const s = await setup();
    await insert(s.householdId, s.memberA, 'えび');
    await insert(s.householdId, s.memberA, 'ピーマン');
    const r = await db.query<{ n: string }>(
      'select count(*) as n from disliked_ingredients where member_id = $1',
      [s.memberA],
    );
    expect(Number(r.rows[0].n)).toBe(2);
  });

  it('同じメンバーの同じ食材は 2 件目を作れない（BR10.2）', async () => {
    const s = await setup();
    await insert(s.householdId, s.memberA, 'えび');
    await expect(insert(s.householdId, s.memberA, 'えび')).rejects.toThrow();
  });

  it('別のメンバーなら、同じ食材でも登録できる。表記が違えば別の食材（正規化しない。BR10.7）', async () => {
    const s = await setup();
    await insert(s.householdId, s.memberA, 'えび');
    await expect(insert(s.householdId, s.memberB, 'えび')).resolves.toBeDefined();
    await expect(insert(s.householdId, s.memberA, '海老')).resolves.toBeDefined();
    await expect(insert(s.householdId, s.memberA, 'エビ')).resolves.toBeDefined();
  });

  it('食材名は 1〜50 文字（BR10.1）', async () => {
    const s = await setup();
    await insert(s.householdId, s.memberA, 'あ'.repeat(50));
    await expect(insert(s.householdId, s.memberA, 'あ'.repeat(51))).rejects.toThrow();
    await expect(insert(s.householdId, s.memberA, '')).rejects.toThrow();
  });

  it('存在しないグループ・メンバーは指せない', async () => {
    const s = await setup();
    await expect(insert(id(), s.memberA, 'えび')).rejects.toThrow();
    await expect(insert(s.householdId, id(), 'えび')).rejects.toThrow();
  });

  it('同時に同じ登録が来ても 1 件だけが成り立つ（on conflict do nothing）', async () => {
    const s = await setup();
    const run = () =>
      db.query(
        `insert into disliked_ingredients (dislike_id, household_id, member_id, ingredient_name)
         values ($1,$2,$3,$4) on conflict (member_id, ingredient_name) do nothing`,
        [id(), s.householdId, s.memberA, 'えび'],
      );
    await Promise.all([run(), run(), run()]);
    const r = await db.query<{ n: string }>(
      'select count(*) as n from disliked_ingredients where member_id = $1',
      [s.memberA],
    );
    expect(Number(r.rows[0].n)).toBe(1);
  });
});
