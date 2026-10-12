import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, Queryable } from '@/db';
import { createTestDb } from '@/test-helpers/db';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const id = () => crypto.randomUUID();
const DATES = Array.from(
  { length: 7 },
  (_, offset) => `2026-03-${String(offset + 1).padStart(2, '0')}`,
);

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

type Setup = Awaited<ReturnType<typeof setup>>;

const insertDay = (
  q: Queryable,
  householdId: string,
  planId: string,
  date: string,
  over: {
    status?: string;
    dishId?: string | null;
    origin?: string | null;
    reason?: string | null;
  } = {},
) =>
  q.query(
    `insert into plan_days (plan_day_id, plan_id, household_id, date, day_status, dish_id, origin, empty_reason)
     values ($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    [
      id(),
      planId,
      householdId,
      date,
      over.status ?? 'empty',
      over.dishId ?? null,
      over.origin ?? null,
      over.status === undefined || over.status === 'empty'
        ? (over.reason ?? 'not_proposed')
        : (over.reason ?? null),
    ],
  );

/** 献立と7日を同じ取引で作る。遅延トリガーを通過する正規状態。 */
async function insertPlan(s: Setup, dates = DATES): Promise<string> {
  return db.transaction(async (tx) => {
    const planId = id();
    await tx.query(
      `insert into meal_plans (plan_id, household_id, start_date, is_saved, created_by, saved_at)
       values ($1,$2,'2026-03-01',false,$3,null)`,
      [planId, s.householdId, s.memberId],
    );
    for (const date of dates) await insertDay(tx, s.householdId, planId, date);
    return planId;
  });
}

describe('献立のデータモデル（004_meal_plan.sql / 008_meal_plan_integrity.sql）', () => {
  it('作業中の献立は、1 つのグループにつき 1 件まで。保存済みは何件でもよい（BR30.15）', async () => {
    const s = await setup();
    await insertPlan(s);
    await expect(insertPlan(s)).rejects.toThrow();
    await db.transaction(async (tx) => {
      const planId = id();
      await tx.query(
        `insert into meal_plans (plan_id, household_id, start_date, is_saved, created_by, saved_at)
         values ($1,$2,'2026-03-01',true,$3,now())`,
        [planId, s.householdId, s.memberId],
      );
      for (const date of DATES) await insertDay(tx, s.householdId, planId, date);
    });
    const other = await setup();
    await expect(insertPlan(other)).resolves.toBeTruthy();
  });

  it('献立は startDate から連続する7日を必ず持ち、0/1/8日や欠落日を拒否する（R-01）', async () => {
    const cases = [
      [],
      DATES.slice(0, 1),
      [...DATES, '2026-03-08'],
      [...DATES.slice(0, 6), '2026-03-08'],
    ];
    for (const dates of cases) {
      const s = await setup();
      await expect(insertPlan(s, dates)).rejects.toThrow();
    }
  });

  it('1 つの献立に同じ日は 1 件まで（BR30.1）', async () => {
    const s = await setup();
    const planId = await insertPlan(s);
    await expect(insertDay(db, s.householdId, planId, DATES[0])).rejects.toThrow();
  });

  it('親献立・日行・料理の household 所属が異なる組み合わせを拒否する（R-02）', async () => {
    const owner = await setup();
    const other = await setup();
    const planId = await insertPlan(owner);

    await expect(insertDay(db, other.householdId, planId, '2026-03-08')).rejects.toThrow();
    await expect(
      db.query(
        `update plan_days set day_status = 'assigned', dish_id = $1, origin = 'assigned_by_user'
         where plan_id = $2 and date = '2026-03-01'`,
        [other.dishId, planId],
      ),
    ).rejects.toThrow();
  });

  it('日の状態と、料理・由来・空欄の理由の組み合わせが合わないものは入らない', async () => {
    const s = await setup();
    const planId = await insertPlan(s);
    await expect(
      db.query(
        `update plan_days set day_status = 'assigned', dish_id = null, origin = null, empty_reason = null
         where plan_id = $1 and date = '2026-03-01'`,
        [planId],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `update plan_days set day_status = 'assigned', dish_id = $2, origin = null, empty_reason = null
         where plan_id = $1 and date = '2026-03-01'`,
        [planId, s.dishId],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `update plan_days set day_status = 'assigned', dish_id = $2, origin = 'suggested', empty_reason = null
         where plan_id = $1 and date = '2026-03-01'`,
        [planId, s.dishId],
      ),
    ).resolves.toBeTruthy();
    await expect(
      db.query(
        `update plan_days set day_status = 'skip', dish_id = $2, origin = null, empty_reason = null
         where plan_id = $1 and date = '2026-03-02'`,
        [planId, s.dishId],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `update plan_days set day_status = 'empty', dish_id = null, origin = null, empty_reason = null
         where plan_id = $1 and date = '2026-03-02'`,
        [planId],
      ),
    ).rejects.toThrow();
  });

  it('保存済みの印と保存日時は同時に付く', async () => {
    const s = await setup();
    await expect(
      db.query(
        `insert into meal_plans (plan_id, household_id, start_date, is_saved, created_by)
         values ($1,$2,'2026-03-01',true,$3)`,
        [id(), s.householdId, s.memberId],
      ),
    ).rejects.toThrow();
  });

  it('献立を消すと、その日も消える', async () => {
    const s = await setup();
    const planId = await insertPlan(s);
    await db.query('delete from meal_plans where plan_id = $1', [planId]);
    const rest = await db.query('select 1 from plan_days where plan_id = $1', [planId]);
    expect(rest.rowCount).toBe(0);
  });

  it('料理の「食材の種類」は決まった値か未入力。列を足しても既存の料理は読める', async () => {
    const s = await setup();
    const before = await db.query<{ ingredient_kind: string | null }>(
      'select ingredient_kind from dishes where dish_id = $1',
      [s.dishId],
    );
    expect(before.rows[0].ingredient_kind).toBeNull();
    await db.query('update dishes set ingredient_kind = $2 where dish_id = $1', [s.dishId, 'fish']);
    await expect(
      db.query('update dishes set ingredient_kind = $2 where dish_id = $1', [s.dishId, 'snack']),
    ).rejects.toThrow();
  });
});
