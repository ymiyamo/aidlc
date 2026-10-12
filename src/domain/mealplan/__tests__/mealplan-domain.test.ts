import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { createDish, listHouseholdDishes, removeDish } from '@/domain/dish';
import { DomainError } from '@/domain/errors';
import { createHousehold } from '@/domain/household';
import { register } from '@/domain/auth';
import { getMealPlanList } from '@/domain/shopping';
import { pick } from '@/domain/suggestion';
import { addDislike, removeDislike, setTasteExclusion, tasteExclusion } from '@/domain/taste';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import {
  MESSAGES,
  addDays,
  assignDish,
  clearSkipDay,
  createShoppingList,
  getCurrentPlan,
  getPlanView,
  listAssignableDishes,
  listSavedPlanSummaries,
  proposePlan,
  recallPlan,
  redoDay,
  redoWeek,
  savePlan,
  setSkipDay,
  type MealPlanView,
} from '..';
import { seeded } from './seeded';

let deps: AppDeps;
let clock: TestClock;
let rng = seeded(1);
beforeAll(async () => {
  ({ deps, clock } = await createTestDeps({ random: () => rng() }));
});
afterAll(async () => {
  await deps.db.close();
});
beforeEach(() => {
  rng = seeded(1);
  // 他のテストファイルが差し替える候補除外の実装に依存しない。
  setTasteExclusion(tasteExclusion);
});

let seq = 0;
const url = () => `https://example.com/plan/${(seq += 1)}`;

/** 初期データ入りのグループ */
const seeded30 = (label: string) => registerWithHousehold(deps, label);

/** 初期データなしの空のグループ */
async function empty(label: string) {
  const u = await registerWithHousehold(deps, label);
  for (const d of await listHouseholdDishes(deps, u.ctx)) await removeDish(deps, u.ctx, d.dishId);
  return u;
}

const START = '2026-03-02';

const ids = (p: MealPlanView) => p.days.map((d) => d.dish?.dishId ?? null);
const assigned = (p: MealPlanView) => p.days.filter((d) => d.dayStatus === 'assigned');
const streak = (p: MealPlanView) => p.sameKindStreak;

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DomainError) return `${e.code}:${(e.data?.code as string | undefined) ?? ''}`;
    throw e;
  }
  return 'ok';
};

describe('提案（BR30.1〜BR30.8、AC9.1.6）', () => {
  it('V1：初期データだけのグループで、乱数を変えて何回提案しても、空欄 0・同じ料理は 1 回・種類は 3 日続かない', async () => {
    const u = await seeded30('v1');
    for (let seed = 1; seed <= 30; seed++) {
      rng = seeded(seed);
      const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
      expect(plan.days).toHaveLength(7);
      expect(plan.emptyCount, `seed ${seed}`).toBe(0);
      expect(new Set(ids(plan)).size).toBe(7);
      expect(streak(plan), `seed ${seed}`).toBe(false);
      expect(plan.days.every((d) => d.origin === 'suggested')).toBe(true);
    }
  });

  it('開始日から連続する 7 日。指定がなければ提案を作った日（日本時間）（BR30.1）', async () => {
    const u = await seeded30('dates');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: '2026-02-26' });
    expect(plan.days.map((d) => d.date)).toEqual([
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
    // テストの時計は 2026-01-01T00:00Z（日本時間でも 1/1 9 時）
    const today = (await proposePlan(deps, u.ctx, {})).plan;
    expect(today.startDate).toBe('2026-01-01');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('日付の形式が正しくなければ入力エラー。7 日の外の「作らない日」も入力エラー', async () => {
    const u = await seeded30('badinput');
    expect(await code(proposePlan(deps, u.ctx, { startDate: '2026-02-30' }))).toBe('validation:');
    expect(await code(proposePlan(deps, u.ctx, { startDate: 'あした' }))).toBe('validation:');
    expect(
      await code(proposePlan(deps, u.ctx, { startDate: START, skipDates: ['2026-04-01'] })),
    ).toBe('validation:');
    expect(await code(proposePlan(deps, u.ctx, { startDate: '' }))).toBe('ok');
  });

  it('V2：除外した食材を含む料理は含まれない。除外を外すと戻る（AC5.1.4）', async () => {
    const u = await seeded30('v2');
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    const shrimp = (await listHouseholdDishes(deps, u.ctx)).find((d) => d.name === 'エビチリ')!;
    for (let seed = 1; seed <= 25; seed++) {
      rng = seeded(seed);
      const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
      expect(ids(plan)).not.toContain(shrimp.dishId);
    }
  });

  it('除外を外すと、その料理は再び提案に入りうる', async () => {
    const u = await seeded30('v2b');
    const { dislike } = await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    const shrimp = (await listHouseholdDishes(deps, u.ctx)).find((d) => d.name === 'エビチリ')!;
    await removeDislike(deps, u.ctx, dislike.id);
    let seen = false;
    for (let seed = 1; seed <= 80 && !seen; seed++) {
      rng = seeded(seed);
      seen = ids((await proposePlan(deps, u.ctx, { startDate: START })).plan).includes(
        shrimp.dishId,
      );
    }
    expect(seen).toBe(true);
  });

  it('V3：5 件しかなければ、「選んだもの」を除かず 5 日が埋まり、2 日が not_enough_dishes の空欄', async () => {
    const u = await empty('v3');
    const made = [];
    for (let i = 0; i < 5; i++) {
      made.push(await createDish(deps, u.ctx, { name: `料理${i}`, url: url() }));
    }
    for (const d of made.slice(0, 3)) await pick(deps, u.ctx, d.dishId);
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    expect(assigned(plan)).toHaveLength(5);
    expect(new Set(ids(plan).filter(Boolean))).toEqual(new Set(made.map((d) => d.dishId)));
    const empties = plan.days.filter((d) => d.dayStatus === 'empty');
    expect(empties).toHaveLength(2);
    expect(empties.every((d) => d.emptyReason === 'not_enough_dishes')).toBe(true);
    expect(plan.emptyCount).toBe(2);
  });

  it('料理が 0 件のときは、7 日すべてが空欄（エラーにしない。BR30.8）', async () => {
    const u = await empty('zero');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    expect(plan.emptyCount).toBe(7);
    expect(plan.days.every((d) => d.emptyReason === 'not_enough_dishes')).toBe(true);
  });

  it('V4：「作らない」を 2 日指定して提案すると、その 2 日は skip で、空きの数に数えない', async () => {
    const u = await empty('v4');
    for (let i = 0; i < 5; i++) await createDish(deps, u.ctx, { name: `料理${i}`, url: url() });
    const { plan } = await proposePlan(deps, u.ctx, {
      startDate: START,
      skipDates: ['2026-03-03', '2026-03-05'],
    });
    expect(plan.days.filter((d) => d.dayStatus === 'skip').map((d) => d.date)).toEqual([
      '2026-03-03',
      '2026-03-05',
    ]);
    expect(plan.skipCount).toBe(2);
    expect(plan.emptyCount).toBe(0);
    expect(assigned(plan)).toHaveLength(5);
  });

  it('新しい提案は前の作業中の献立を捨てる（作業中は 1 件。保存済みは残る。BR30.15）', async () => {
    const u = await seeded30('discard');
    const first = (await proposePlan(deps, u.ctx, { startDate: START })).plan;
    await savePlan(deps, u.ctx, first.planId, {});
    const second = (await proposePlan(deps, u.ctx, { startDate: START })).plan;
    const third = (await proposePlan(deps, u.ctx, { startDate: START })).plan;
    expect((await getCurrentPlan(deps, u.ctx))!.planId).toBe(third.planId);
    expect(await code(getPlanView(deps, u.ctx, second.planId))).toBe('not_found:');
    expect((await getPlanView(deps, u.ctx, first.planId)).isSaved).toBe(true);
  });

  it('U5 の「もう作りたくない」の料理は、ほかの料理が足りているあいだは使わない（BR40.20）', async () => {
    const u = await empty('never');
    const made: Awaited<ReturnType<typeof createDish>>[] = [];
    for (let i = 0; i < 8; i++) {
      made.push(await createDish(deps, u.ctx, { name: `料理${i}`, url: url() }));
    }
    const { setImpressionJudge } = await import('@/domain/suggestion');
    setImpressionJudge(
      async (_d, _h, dishIds) =>
        new Map(dishIds.map((id) => [id, id === made[0].dishId ? 'never_again' : 'none'] as const)),
    );
    try {
      for (let seed = 1; seed <= 15; seed++) {
        rng = seeded(seed);
        const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
        expect(ids(plan)).not.toContain(made[0].dishId);
      }
    } finally {
      setImpressionJudge(null);
    }
  });
});

describe('やり直し（BR30.9、BR30.12）', () => {
  it('V6：日のやり直しは、他の 6 日を動かさず、その日の料理を変える', async () => {
    const u = await seeded30('v6');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    for (const i of [0, 3, 6]) {
      const before = (await getPlanView(deps, u.ctx, plan.planId)).days;
      const res = await redoDay(deps, u.ctx, plan.planId, before[i].date);
      const after = res.plan.days;
      expect(res.notices).toEqual([]);
      after.forEach((d, j) => {
        if (j === i) expect(d.dish!.dishId).not.toBe(before[j].dish!.dishId);
        else expect(d).toEqual(before[j]);
      });
      expect(new Set(ids(res.plan)).size).toBe(7);
      expect(streak(res.plan)).toBe(false);
    }
  });

  it('空欄の日をやり直すと、料理が入って埋まる', async () => {
    const u = await seeded30('fill');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START, skipDates: [START] });
    await clearSkipDay(deps, u.ctx, plan.planId, START);
    const res = await redoDay(deps, u.ctx, plan.planId, START);
    expect(res.plan.days[0].dayStatus).toBe('assigned');
    expect(res.plan.emptyCount).toBe(0);
  });

  it('他に使える料理がなければ今のまま、案内を返す（空欄にはしない）', async () => {
    const u = await empty('nodish');
    await createDish(deps, u.ctx, { name: '一品だけ', url: url() });
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const filled = plan.days.find((d) => d.dayStatus === 'assigned')!;
    const res = await redoDay(deps, u.ctx, plan.planId, filled.date);
    expect(res.notices.map((n) => n.code)).toEqual(['NO_OTHER_DISH']);
    expect(res.plan.days).toEqual(plan.days);
  });

  it('作らない日のやり直しは断る。日付が献立にないときは見つからない', async () => {
    const u = await seeded30('redoskip');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    await setSkipDay(deps, u.ctx, plan.planId, START);
    expect(await code(redoDay(deps, u.ctx, plan.planId, START))).toBe('conflict:DAY_IS_SKIP');
    expect(await code(redoDay(deps, u.ctx, plan.planId, '2026-04-01'))).toBe('not_found:');
    expect(await code(redoDay(deps, u.ctx, plan.planId, 'きのう'))).toBe('not_found:');
  });

  it('V7：週全体のやり直しは、作らない日を保ち、直前と同じ並びにしない', async () => {
    const u = await seeded30('v7');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    await setSkipDay(deps, u.ctx, plan.planId, '2026-03-04');
    for (let i = 0; i < 5; i++) {
      const before = await getPlanView(deps, u.ctx, plan.planId);
      const res = await redoWeek(deps, u.ctx, plan.planId);
      expect(res.plan.days[2].dayStatus).toBe('skip');
      expect(res.plan.skipCount).toBe(1);
      expect(res.plan.emptyCount).toBe(0);
      expect(ids(res.plan)).not.toEqual(ids(before));
      expect(streak(res.plan)).toBe(false);
    }
  });

  it('週全体のやり直しは、手で割り当てた日も置き換える', async () => {
    const u = await seeded30('weekreplace');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const target = (await listHouseholdDishes(deps, u.ctx)).find(
      (d) => !ids(plan).includes(d.dishId),
    )!;
    await assignDish(deps, u.ctx, plan.planId, START, target.dishId);
    const res = await redoWeek(deps, u.ctx, plan.planId);
    expect(res.plan.days.every((d) => d.origin === 'suggested')).toBe(true);
  });

  it('別の組み合わせがなければ今のまま、案内を返す', async () => {
    const u = await empty('nocombo');
    for (let i = 0; i < 7; i++) await createDish(deps, u.ctx, { name: `料理${i}`, url: url() });
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    for (const d of plan.days.slice(1)) await setSkipDay(deps, u.ctx, plan.planId, d.date);
    const res = await redoWeek(deps, u.ctx, plan.planId);
    // 1 日だけ残して 7 件から選ぶので別の料理はあるが、候補が 1 件だけなら変えられない
    expect(res.plan.skipCount).toBe(6);
    const single = await empty('nocombo2');
    await createDish(deps, single.ctx, { name: '一品', url: url() });
    const p2 = (await proposePlan(deps, single.ctx, { startDate: START })).plan;
    const res2 = await redoWeek(deps, single.ctx, p2.planId);
    expect(res2.notices.map((n) => n.code)).toEqual(['NO_OTHER_COMBINATION']);
    expect(res2.plan.days).toEqual(p2.days);
  });
});

describe('作らない日（BR30.10、BR30.11、BR30.13）', () => {
  it('設定すると料理が外れて skip になる。繰り返しても同じ。解除すると not_proposed の空欄になる', async () => {
    const u = await seeded30('skip');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const a = await setSkipDay(deps, u.ctx, plan.planId, START);
    expect(a.plan.days[0]).toMatchObject({
      dayStatus: 'skip',
      dish: null,
      origin: null,
      emptyReason: null,
    });
    const b = await setSkipDay(deps, u.ctx, plan.planId, START);
    expect(b.plan).toEqual(a.plan);
    expect(a.plan.emptyCount).toBe(0);
    expect(a.plan.skipCount).toBe(1);
    const c = await clearSkipDay(deps, u.ctx, plan.planId, START);
    expect(c.plan.days[0]).toMatchObject({
      dayStatus: 'empty',
      emptyReason: 'not_proposed',
      dish: null,
    });
    expect(c.plan.emptyCount).toBe(1);
    // 解除の繰り返しは何もしない。料理が入った日の解除も何もしない
    expect((await clearSkipDay(deps, u.ctx, plan.planId, START)).plan).toEqual(c.plan);
    expect(
      (await clearSkipDay(deps, u.ctx, plan.planId, '2026-03-03')).plan.days[1].dayStatus,
    ).toBe('assigned');
  });

  it('解除した日は、日のやり直しか手割り当てで料理が入る', async () => {
    const u = await seeded30('unskip');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    await setSkipDay(deps, u.ctx, plan.planId, START);
    await clearSkipDay(deps, u.ctx, plan.planId, START);
    const target = (await listHouseholdDishes(deps, u.ctx)).find(
      (d) => !ids(plan).includes(d.dishId),
    )!;
    const res = await assignDish(deps, u.ctx, plan.planId, START, target.dishId);
    expect(res.plan.days[0]).toMatchObject({ dayStatus: 'assigned', origin: 'assigned_by_user' });
  });
});

describe('手割り当て（BR30.16、BR30.17）', () => {
  it('「選んだもの」が割り当て候補になる。削除済みは入らない', async () => {
    const u = await seeded30('assignable');
    expect(await listAssignableDishes(deps, u.ctx)).toEqual([]);
    const dishes = await listHouseholdDishes(deps, u.ctx);
    await pick(deps, u.ctx, dishes[0].dishId);
    await pick(deps, u.ctx, dishes[1].dishId);
    expect((await listAssignableDishes(deps, u.ctx)).map((d) => d.dishId).sort()).toEqual(
      [dishes[0].dishId, dishes[1].dishId].sort(),
    );
    await removeDish(deps, u.ctx, dishes[1].dishId);
    expect((await listAssignableDishes(deps, u.ctx)).map((d) => d.dishId)).toEqual([
      dishes[0].dishId,
    ]);
  });

  it('割り当てた日は assigned_by_user になる。同じ日に同じ料理を割り当て直しても結果は同じ', async () => {
    const u = await seeded30('assign');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const target = (await listHouseholdDishes(deps, u.ctx)).find(
      (d) => !ids(plan).includes(d.dishId),
    )!;
    const a = await assignDish(deps, u.ctx, plan.planId, '2026-03-03', target.dishId);
    expect(a.plan.days[1]).toMatchObject({ dayStatus: 'assigned', origin: 'assigned_by_user' });
    expect(a.plan.days[1].dish!.dishId).toBe(target.dishId);
    const b = await assignDish(deps, u.ctx, plan.planId, '2026-03-03', target.dishId);
    expect(b.plan).toEqual(a.plan);
  });

  it('作らない日には割り当てられない。同じ料理の 3 回目は断る（手割り当ては 2 回まで）', async () => {
    const u = await seeded30('limit');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const target = (await listHouseholdDishes(deps, u.ctx)).find(
      (d) => !ids(plan).includes(d.dishId),
    )!;
    await setSkipDay(deps, u.ctx, plan.planId, '2026-03-08');
    expect(await code(assignDish(deps, u.ctx, plan.planId, '2026-03-08', target.dishId))).toBe(
      'conflict:DAY_IS_SKIP',
    );
    expect(await code(assignDish(deps, u.ctx, plan.planId, '2026-03-02', target.dishId))).toBe(
      'ok',
    );
    expect(await code(assignDish(deps, u.ctx, plan.planId, '2026-03-04', target.dishId))).toBe(
      'ok',
    );
    expect(await code(assignDish(deps, u.ctx, plan.planId, '2026-03-06', target.dishId))).toBe(
      'conflict:DISH_LIMIT',
    );
    const now = await getPlanView(deps, u.ctx, plan.planId);
    expect(now.days.filter((d) => d.dish?.dishId === target.dishId)).toHaveLength(2);
  });

  it('同じ種類が 3 日続くときは、断らずに注意を返して割り当てる', async () => {
    const u = await empty('kindwarn');
    const meats = [];
    for (let i = 0; i < 3; i++) {
      meats.push(
        await createDish(deps, u.ctx, { name: `肉${i}`, url: url(), ingredientKind: 'meat' }),
      );
    }
    const { plan } = await proposePlan(deps, u.ctx, {
      startDate: START,
      skipDates: ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'],
    });
    // 3 日（3/2〜3/4）に肉が 3 つ入る提案は作られない（2 日続きまで）ので、残りを手で埋める
    const free = plan.days.filter((d) => d.dayStatus !== 'skip').map((d) => d.date);
    expect(free).toHaveLength(3);
    let last = { notices: [] as { code: string }[] };
    for (const [i, date] of free.entries()) {
      last = await assignDish(deps, u.ctx, plan.planId, date, meats[i].dishId);
    }
    expect(last.notices.map((n) => n.code)).toEqual(['SAME_KIND_STREAK']);
    expect((await getPlanView(deps, u.ctx, plan.planId)).sameKindStreak).toBe(true);
  });

  it('他のグループの料理・削除済みの料理は見つからない。除外している料理は断る', async () => {
    const a = await seeded30('assign-a');
    const b = await seeded30('assign-b');
    const { plan } = await proposePlan(deps, a.ctx, { startDate: START });
    const foreign = (await listHouseholdDishes(deps, b.ctx))[0];
    expect(await code(assignDish(deps, a.ctx, plan.planId, START, foreign.dishId))).toBe(
      'not_found:',
    );
    expect(await code(assignDish(deps, a.ctx, plan.planId, START, 'abc'))).toBe('not_found:');
    expect(await code(assignDish(deps, a.ctx, plan.planId, START, 123))).toBe('validation:');
    const mine = await listHouseholdDishes(deps, a.ctx);
    await removeDish(deps, a.ctx, mine[0].dishId);
    expect(await code(assignDish(deps, a.ctx, plan.planId, START, mine[0].dishId))).toBe(
      'not_found:',
    );
    const shrimp = mine.find((d) => d.name === 'エビチリ')!;
    await addDislike(deps, a.ctx, { ingredientName: 'えび' });
    expect(await code(assignDish(deps, a.ctx, plan.planId, START, shrimp.dishId))).toBe(
      'conflict:DISH_NOT_AVAILABLE',
    );
    // 「選んだもの」にしてあれば、除外していても割り当てられる
    await pick(deps, a.ctx, shrimp.dishId);
    expect(await code(assignDish(deps, a.ctx, plan.planId, START, shrimp.dishId))).toBe('ok');
  });
});

describe('保存と呼び出し（BR30.14、BR30.15、BR30.21）', () => {
  it('保存すると名前が付き（既定は M/D からの献立）、変更の操作はすべて断られる。繰り返しても同じ', async () => {
    const u = await seeded30('save');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const saved = await savePlan(deps, u.ctx, plan.planId, {});
    expect(saved).toMatchObject({ isSaved: true, name: '3/2からの献立' });
    expect(saved.savedAt).not.toBeNull();
    expect((await savePlan(deps, u.ctx, plan.planId, { name: '別名' })).name).toBe('3/2からの献立');
    const refused = 'conflict:PLAN_SAVED';
    expect(await code(redoDay(deps, u.ctx, plan.planId, START))).toBe(refused);
    expect(await code(redoWeek(deps, u.ctx, plan.planId))).toBe(refused);
    expect(await code(setSkipDay(deps, u.ctx, plan.planId, START))).toBe(refused);
    expect(await code(clearSkipDay(deps, u.ctx, plan.planId, START))).toBe(refused);
    const any = (await listHouseholdDishes(deps, u.ctx))[0];
    expect(await code(assignDish(deps, u.ctx, plan.planId, START, any.dishId))).toBe(refused);
    expect(await getPlanView(deps, u.ctx, plan.planId)).toEqual(saved);
    expect(await getCurrentPlan(deps, u.ctx)).toBeNull();
    expect(MESSAGES.planSaved).toContain('保存した献立は変更できません');
  });

  it('名前を付けて保存できる。50 文字を超えると入力エラー。一覧は新しい順', async () => {
    const u = await seeded30('names');
    const p1 = (await proposePlan(deps, u.ctx, { startDate: START })).plan;
    expect(await code(savePlan(deps, u.ctx, p1.planId, { name: 'あ'.repeat(51) }))).toBe(
      'validation:',
    );
    expect((await savePlan(deps, u.ctx, p1.planId, { name: '  来週の献立 ' })).name).toBe(
      '来週の献立',
    );
    clock.advanceMs(60_000); // 保存の時刻が違えば、新しい保存が先に並ぶ
    const p2 = (await proposePlan(deps, u.ctx, { startDate: '2026-03-09' })).plan;
    await savePlan(deps, u.ctx, p2.planId, {});
    const list = await listSavedPlanSummaries(deps, u.ctx);
    expect(list.map((p) => p.name)).toEqual(['3/9からの献立', '来週の献立']);
  });

  it('V8：保存してから呼び出して変更しても、保存済みの元は変わらない。再保存は別の献立になる', async () => {
    const u = await seeded30('v8');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const saved = await savePlan(deps, u.ctx, plan.planId, {});
    const { plan: copy } = await recallPlan(deps, u.ctx, saved.planId);
    expect(copy.planId).not.toBe(saved.planId);
    expect(copy.isSaved).toBe(false);
    expect(copy.days).toEqual(saved.days);
    await setSkipDay(deps, u.ctx, copy.planId, START);
    await redoDay(deps, u.ctx, copy.planId, '2026-03-04');
    expect(await getPlanView(deps, u.ctx, saved.planId)).toEqual(saved);
    const again = await savePlan(deps, u.ctx, copy.planId, { name: '変更後' });
    expect(again.planId).not.toBe(saved.planId);
    expect((await listSavedPlanSummaries(deps, u.ctx)).map((p) => p.name).sort()).toEqual(
      ['3/2からの献立', '変更後'].sort(),
    );
  });

  it('V3a：「選んだもの」の料理を割り当てて保存・呼び出ししても、assigned のまま', async () => {
    const u = await seeded30('v3a');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const target = (await listHouseholdDishes(deps, u.ctx)).find(
      (d) => !ids(plan).includes(d.dishId),
    )!;
    await pick(deps, u.ctx, target.dishId);
    await assignDish(deps, u.ctx, plan.planId, START, target.dishId);
    const saved = await savePlan(deps, u.ctx, plan.planId, {});
    const { plan: copy } = await recallPlan(deps, u.ctx, saved.planId);
    expect(copy.days[0]).toMatchObject({ dayStatus: 'assigned', origin: 'assigned_by_user' });
    expect(copy.days[0].dish!.dishId).toBe(target.dishId);
  });

  it('呼び出し時、削除済み・新しく除外された料理の日は dish_unavailable の空欄になる。保存済みの元には削除済みが残る', async () => {
    const u = await seeded30('unavail');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const saved = await savePlan(deps, u.ctx, plan.planId, {});
    const deleted = saved.days[1].dish!;
    await removeDish(deps, u.ctx, deleted.dishId);
    const viewSaved = await getPlanView(deps, u.ctx, saved.planId);
    expect(viewSaved.days[1].dish).toMatchObject({
      dishId: deleted.dishId,
      deleted: true,
      name: deleted.name,
    });
    const { plan: copy } = await recallPlan(deps, u.ctx, saved.planId);
    expect(copy.days[1]).toMatchObject({
      dayStatus: 'empty',
      emptyReason: 'dish_unavailable',
      dish: null,
    });
    expect(copy.emptyCount).toBe(1);
    // 除外：先頭の日の料理の材料を嫌いにする
    const first = saved.days[0].dish!;
    const all = await listHouseholdDishes(deps, u.ctx);
    const ing = all.find((d) => d.dishId === first.dishId)!.ingredients[0].name;
    await addDislike(deps, u.ctx, { ingredientName: ing });
    const { plan: copy2 } = await recallPlan(deps, u.ctx, saved.planId);
    expect(copy2.days[0]).toMatchObject({ dayStatus: 'empty', emptyReason: 'dish_unavailable' });
  });

  it('呼び出しは前の作業中の献立を捨てる。作業中の献立は呼び出せない', async () => {
    const u = await seeded30('recall2');
    const first = (await proposePlan(deps, u.ctx, { startDate: START })).plan;
    const saved = await savePlan(deps, u.ctx, first.planId, {});
    const working = (await proposePlan(deps, u.ctx, { startDate: '2026-03-09' })).plan;
    const { plan: copy } = await recallPlan(deps, u.ctx, saved.planId);
    expect((await getCurrentPlan(deps, u.ctx))!.planId).toBe(copy.planId);
    expect(await code(getPlanView(deps, u.ctx, working.planId))).toBe('not_found:');
    expect(await code(recallPlan(deps, u.ctx, copy.planId))).toBe('not_found:');
  });
});

describe('買い物リストへの受け渡し（BR30.18）', () => {
  it('V10：作らない日・空欄の日の料理の材料は渡されない。料理がある日の材料だけが入る', async () => {
    const u = await empty('v10');
    const dishes = [];
    for (const [i, ing] of ['ひじき', 'ごぼう', 'れんこん', 'ごま', 'のり'].entries()) {
      dishes.push(
        await createDish(deps, u.ctx, {
          name: `料理${i}`,
          url: url(),
          ingredients: [{ name: ing, amount: '1', unit: '個' }],
        }),
      );
    }
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const skipped = plan.days[1].dish!;
    await setSkipDay(deps, u.ctx, plan.planId, plan.days[1].date);
    const res = await createShoppingList(deps, u.ctx, plan.planId);
    const names = res.list.items.map((i) => i.ingredientName);
    const skippedIngredient = dishes.find((d) => d.dishId === skipped.dishId)!.ingredients[0].name;
    expect(names).not.toContain(skippedIngredient);
    expect(names).toHaveLength(4);
    expect(res.list.source).toBe('mealPlan');
    expect(res.list.planId).toBe(plan.planId);
    expect(res.skippedDeleted).toBe(0);
    expect(res.message).toBeNull();
  });

  it('同じ料理が 2 日あれば材料は合算される（U3 の担当）。材料が未入力の料理は「入力が必要」の行になる', async () => {
    const u = await empty('compose');
    const a = await createDish(deps, u.ctx, {
      name: 'A',
      url: url(),
      ingredients: [{ name: '玉ねぎ', amount: '1', unit: '個' }],
    });
    const none = await createDish(deps, u.ctx, { name: '材料なし', url: url() });
    const { plan } = await proposePlan(deps, u.ctx, {
      startDate: START,
      skipDates: ['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'],
    });
    const free = plan.days.filter((d) => d.dayStatus !== 'skip');
    await assignDish(deps, u.ctx, plan.planId, free[0].date, a.dishId);
    await assignDish(deps, u.ctx, plan.planId, free[1].date, none.dishId);
    const first = await createShoppingList(deps, u.ctx, plan.planId);
    expect(first.list.items.filter((i) => i.kind === 'ingredient')).toHaveLength(1);
    expect(first.list.items.filter((i) => i.kind === 'needsInput')).toHaveLength(1);
    // 同じ献立で作り直しても、リストは 1 つのまま
    const second = await createShoppingList(deps, u.ctx, plan.planId);
    expect(second.list.listId).toBe(first.list.listId);
  });

  it('削除済みの料理の日は材料に含めず、案内を返す。保存済みの献立からも作れる', async () => {
    const u = await seeded30('delshop');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    const saved = await savePlan(deps, u.ctx, plan.planId, {});
    await removeDish(deps, u.ctx, saved.days[0].dish!.dishId);
    const res = await createShoppingList(deps, u.ctx, saved.planId);
    expect(res.skippedDeleted).toBe(1);
    expect(res.message).toBe(MESSAGES.deletedSkipped);
    expect(res.list.items.length).toBeGreaterThan(0);
  });

  it('料理がある日が 0 件のときは作らずに断る', async () => {
    const u = await seeded30('noshop');
    const { plan } = await proposePlan(deps, u.ctx, { startDate: START });
    for (const d of plan.days) await setSkipDay(deps, u.ctx, plan.planId, d.date);
    expect(await code(createShoppingList(deps, u.ctx, plan.planId))).toBe(
      'conflict:NO_INGREDIENTS',
    );
    const e = await empty('noshop2');
    const p = (await proposePlan(deps, e.ctx, { startDate: START })).plan;
    expect(await code(createShoppingList(deps, e.ctx, p.planId))).toBe('conflict:NO_INGREDIENTS');
    expect(await getMealPlanList(deps, e.ctx, p.planId)).toBeNull();
  });
});

describe('グループの範囲と削除（BR30.20、BR30.22）', () => {
  it('他のグループの献立は、読む・変える・保存する・呼び出す・買い物リストを作る、すべて「見つからない」', async () => {
    const a = await seeded30('scope-a');
    const b = await seeded30('scope-b');
    const { plan } = await proposePlan(deps, a.ctx, { startDate: START });
    const saved = await savePlan(
      deps,
      a.ctx,
      (await proposePlan(deps, a.ctx, { startDate: START })).plan.planId,
      {},
    );
    const nf = 'not_found:';
    for (const planId of [plan.planId, saved.planId]) {
      expect(await code(getPlanView(deps, b.ctx, planId))).toBe(nf);
      expect(await code(redoDay(deps, b.ctx, planId, START))).toBe(nf);
      expect(await code(redoWeek(deps, b.ctx, planId))).toBe(nf);
      expect(await code(setSkipDay(deps, b.ctx, planId, START))).toBe(nf);
      expect(await code(clearSkipDay(deps, b.ctx, planId, START))).toBe(nf);
      expect(await code(savePlan(deps, b.ctx, planId, {}))).toBe(nf);
      expect(await code(recallPlan(deps, b.ctx, planId))).toBe(nf);
      expect(await code(createShoppingList(deps, b.ctx, planId))).toBe(nf);
      const mine = (await listHouseholdDishes(deps, b.ctx))[0];
      expect(await code(assignDish(deps, b.ctx, planId, START, mine.dishId))).toBe(nf);
    }
    expect(await getCurrentPlan(deps, b.ctx)).toBeNull();
    expect(await listSavedPlanSummaries(deps, b.ctx)).toEqual([]);
    expect(await code(getPlanView(deps, a.ctx, 'not-a-uuid'))).toBe(nf);
  });

  it('household.deleted を受けると、そのグループの献立がすべて消える。何度受けても同じ', async () => {
    const a = await seeded30('del-a');
    const b = await seeded30('del-b');
    const pa = (await proposePlan(deps, a.ctx, { startDate: START })).plan;
    await savePlan(deps, a.ctx, pa.planId, {});
    await proposePlan(deps, a.ctx, { startDate: START });
    const pb = (await proposePlan(deps, b.ctx, { startDate: START })).plan;
    const event = { eventId: crypto.randomUUID(), householdId: a.householdId };
    await deps.events.publish('household.deleted', event);
    await deps.events.publish('household.deleted', event);
    const left = await deps.db.query('select 1 from meal_plans where household_id = $1', [
      a.householdId,
    ]);
    expect(left.rowCount).toBe(0);
    const leftDays = await deps.db.query('select 1 from plan_days where household_id = $1', [
      a.householdId,
    ]);
    expect(leftDays.rowCount).toBe(0);
    expect((await getPlanView(deps, b.ctx, pb.planId)).planId).toBe(pb.planId);
  });

  it('グループのない人は、そもそも献立を作れない（入口で止まるので、ここでは作成直後の空の状態だけ確認）', async () => {
    const s = await register(deps, {
      email: 'plan-loner@example.com',
      password: 'password-1234',
      displayName: 'l',
    });
    const { householdId, memberId } = await createHousehold(deps, s.accountId, { name: 'x' });
    expect(await getCurrentPlan(deps, { householdId, memberId })).toBeNull();
  });
});
