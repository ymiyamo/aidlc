import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { createDish, editDish, removeDish } from '@/domain/dish';
import { pick } from '@/domain/suggestion';
import { getDish, listCandidateIds } from '@/repo/dishes';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import {
  deletePlansOfHousehold,
  deleteWorkingPlan,
  getPlan,
  getPlanDishes,
  getWorkingPlan,
  insertPlan,
  listDays,
  listSavedPlans,
  markSaved,
  updateDay,
  type DayContent,
} from '..';

let deps: AppDeps;
beforeAll(async () => {
  ({ deps } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

let seq = 0;
const url = () => `https://example.com/repo/${(seq += 1)}`;
const now = new Date('2026-03-01T00:00:00Z');

/** 初期データ入りのグループと、料理 1 件 */
async function world(label: string) {
  const h = await registerWithHousehold(deps, label);
  const dish = await createDish(deps, h.ctx, {
    name: `${label}の料理`,
    url: url(),
    ingredientKind: 'fish',
    ingredients: [{ name: 'さば', amount: '2', unit: '切れ' }],
  });
  return { ...h, dish };
}

const DATES = [
  '2026-03-01',
  '2026-03-02',
  '2026-03-03',
  '2026-03-04',
  '2026-03-05',
  '2026-03-06',
  '2026-03-07',
];

async function makePlan(
  w: { householdId: string; memberId: string; dish: { dishId: string } },
  contents?: DayContent[],
) {
  const planId = crypto.randomUUID();
  await deps.db.transaction((tx) =>
    insertPlan(tx, w.householdId, {
      planId,
      startDate: DATES[0],
      createdBy: w.memberId,
      now,
      days: DATES.map((date, i) => ({
        planDayId: crypto.randomUUID(),
        date,
        content: contents?.[i] ?? { dayStatus: 'empty', emptyReason: 'not_proposed' },
      })),
    }),
  );
  return planId;
}

describe('献立のリポジトリ', () => {
  it('作って読める：日付は YYYY-MM-DD の文字列、日は日付順', async () => {
    const w = await world('roundtrip');
    const planId = await makePlan(w, [
      { dayStatus: 'assigned', dishId: w.dish.dishId, origin: 'suggested' },
      { dayStatus: 'skip' },
    ]);
    const plan = await getWorkingPlan(deps.db, w.householdId);
    expect(plan).toMatchObject({ planId, startDate: '2026-03-01', isSaved: false, name: null });
    const days = await listDays(deps.db, w.householdId, planId);
    expect(days.map((d) => d.date)).toEqual(DATES);
    expect(days[0]).toMatchObject({
      dayStatus: 'assigned',
      dishId: w.dish.dishId,
      origin: 'suggested',
    });
    expect(days[1]).toMatchObject({ dayStatus: 'skip', dishId: null, emptyReason: null });
    expect(days[2]).toMatchObject({ dayStatus: 'empty', emptyReason: 'not_proposed' });
  });

  it('他のグループの献立は、取得も更新も保存もできない（BR30.20）', async () => {
    const a = await world('own-a');
    const b = await world('own-b');
    const planId = await makePlan(a);
    expect(await getPlan(deps.db, b.householdId, planId)).toBeNull();
    expect(await getWorkingPlan(deps.db, b.householdId)).toBeNull();
    expect(await listDays(deps.db, b.householdId, planId)).toEqual([]);
    expect(await updateDay(deps.db, b.householdId, planId, DATES[0], { dayStatus: 'skip' })).toBe(
      false,
    );
    expect(await markSaved(deps.db, b.householdId, planId, { name: 'x', now })).toBe(false);
    // 持ち主のグループからは変わらず読める
    expect((await listDays(deps.db, a.householdId, planId))[0].dayStatus).toBe('empty');
  });

  it('保存済みの献立の日は、更新も再保存もできない（BR30.14）', async () => {
    const w = await world('saved');
    const planId = await makePlan(w);
    expect(await markSaved(deps.db, w.householdId, planId, { name: '来週', now })).toBe(true);
    expect(await markSaved(deps.db, w.householdId, planId, { name: '別名', now })).toBe(false);
    expect(await updateDay(deps.db, w.householdId, planId, DATES[0], { dayStatus: 'skip' })).toBe(
      false,
    );
    expect((await listDays(deps.db, w.householdId, planId))[0].dayStatus).toBe('empty');
    expect(await getWorkingPlan(deps.db, w.householdId)).toBeNull();
    const saved = await listSavedPlans(deps.db, w.householdId);
    expect(saved.map((p) => p.name)).toEqual(['来週']);
  });

  it('作業中の献立だけを捨てる。保存済みは残る（BR30.15）', async () => {
    const w = await world('discard');
    const savedId = await makePlan(w);
    await markSaved(deps.db, w.householdId, savedId, { name: '保存', now });
    const workingId = await makePlan(w);
    expect(await deleteWorkingPlan(deps.db, w.householdId)).toBe(1);
    expect(await getPlan(deps.db, w.householdId, workingId)).toBeNull();
    expect(await listDays(deps.db, w.householdId, workingId)).toEqual([]);
    expect(await getPlan(deps.db, w.householdId, savedId)).not.toBeNull();
    expect(await deleteWorkingPlan(deps.db, w.householdId)).toBe(0);
  });

  it('グループの献立をすべて消す。何度呼んでも同じ（BR30.22）', async () => {
    const a = await world('wipe-a');
    const b = await world('wipe-b');
    const keep = await makePlan(b);
    const planId = await makePlan(a);
    await markSaved(deps.db, a.householdId, planId, { name: 's', now });
    await makePlan(a);
    expect(await deletePlansOfHousehold(deps.db, a.householdId)).toBe(2);
    expect(await deletePlansOfHousehold(deps.db, a.householdId)).toBe(0);
    expect(await getPlan(deps.db, b.householdId, keep)).not.toBeNull();
  });

  it('料理の要約は削除済みも含み、他のグループの料理は含まない', async () => {
    const a = await world('sum-a');
    const b = await world('sum-b');
    await removeDish(deps, a.ctx, a.dish.dishId);
    const got = await getPlanDishes(deps.db, a.householdId, [a.dish.dishId, b.dish.dishId]);
    expect([...got.keys()]).toEqual([a.dish.dishId]);
    expect(got.get(a.dish.dishId)).toMatchObject({ deleted: true, ingredientKind: 'fish' });
    expect(got.get(a.dish.dishId)!.ingredients[0].name).toBe('さば');
    expect((await getPlanDishes(deps.db, a.householdId, [])).size).toBe(0);
  });
});

describe('料理の候補（includePicked）と食材の種類', () => {
  it('includePicked を指定しない呼び出しは変わらない。true で「選んだもの」も含む', async () => {
    const w = await world('picked');
    const other = await createDish(deps, w.ctx, { name: '別の料理', url: url() });
    await pick(deps, w.ctx, w.dish.dishId);
    const normal = await listCandidateIds(deps.db, w.householdId);
    expect(normal).not.toContain(w.dish.dishId);
    expect(normal).toContain(other.dishId);
    const withPicked = await listCandidateIds(deps.db, w.householdId, { includePicked: true });
    expect(withPicked).toContain(w.dish.dishId);
    expect(withPicked.length).toBe(normal.length + 1);
    expect(await listCandidateIds(deps.db, w.householdId, { includePicked: false })).toEqual(
      normal,
    );
  });

  it('includePicked でも、削除済みと除外した食材の料理は含まない', async () => {
    const w = await world('picked-ex');
    await pick(deps, w.ctx, w.dish.dishId);
    const ids = await listCandidateIds(deps.db, w.householdId, {
      includePicked: true,
      excluded: ['さば'],
    });
    expect(ids).not.toContain(w.dish.dishId);
    await removeDish(deps, w.ctx, w.dish.dishId);
    expect(await listCandidateIds(deps.db, w.householdId, { includePicked: true })).not.toContain(
      w.dish.dishId,
    );
  });

  it('食材の種類は保存で保たれ、種類を送らない編集では変わらず、null を送ると消える', async () => {
    const w = await world('kind');
    expect((await getDish(deps.db, w.householdId, w.dish.dishId))!.ingredientKind).toBe('fish');
    const base = { name: w.dish.name, url: w.dish.url };
    await editDish(deps, w.ctx, w.dish.dishId, { ...base, memo: 'メモ' });
    expect((await getDish(deps.db, w.householdId, w.dish.dishId))!.ingredientKind).toBe('fish');
    await editDish(deps, w.ctx, w.dish.dishId, { ...base, ingredientKind: 'meat' });
    expect((await getDish(deps.db, w.householdId, w.dish.dishId))!.ingredientKind).toBe('meat');
    await editDish(deps, w.ctx, w.dish.dishId, { ...base, ingredientKind: '' });
    expect((await getDish(deps.db, w.householdId, w.dish.dishId))!.ingredientKind).toBeNull();
  });

  it('初期データ 30 件は、すべて種類を持ち、3 種類以上に分かれ、どの種類も半分以下（BR30.19）', async () => {
    const w = await registerWithHousehold(deps, 'seedkinds');
    const res = await deps.db.query<{ ingredient_kind: string | null; n: string }>(
      `select ingredient_kind, count(*) as n from dishes
       where household_id = $1 and source = 'seed' group by ingredient_kind`,
      [w.householdId],
    );
    const counts = res.rows.map((r) => [r.ingredient_kind, Number(r.n)] as const);
    expect(counts.some(([k]) => k === null)).toBe(false);
    expect(counts.length).toBeGreaterThanOrEqual(3);
    expect(counts.reduce((a, [, n]) => a + n, 0)).toBe(30);
    expect(Math.max(...counts.map(([, n]) => n))).toBeLessThanOrEqual(15);
  });
});
