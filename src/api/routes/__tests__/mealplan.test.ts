import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { register } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { listHouseholdDishes } from '@/domain/dish';
import { pick } from '@/domain/suggestion';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import { mealPlanClient } from './mealplan-harness';

let deps: AppDeps;
beforeAll(async () => {
  ({ deps } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

const START = '2026-03-02';

/** ログイン済みでグループもあるクライアント（初期データ入り） */
async function member(label = 'm') {
  const h = await registerWithHousehold(deps, label);
  return { ...h, api: mealPlanClient(deps, h.session.token) };
}

const PLAN = (id: string) => `/api/meal-plans/${id}`;
const DAY = (id: string, date: string, tail: string) =>
  `/api/meal-plans/${id}/days/${date}/${tail}`;

describe('入口：未ログイン・グループなし・CSRF', () => {
  const fake = crypto.randomUUID();
  const calls: [string, string, unknown][] = [
    ['GET', '/api/meal-plans/current', undefined],
    ['GET', '/api/meal-plans/assignable', undefined],
    ['GET', '/api/meal-plans', undefined],
    ['POST', '/api/meal-plans', {}],
    ['GET', PLAN(fake), undefined],
    ['POST', `${PLAN(fake)}/redo`, {}],
    ['POST', DAY(fake, START, 'redo'), {}],
    ['PUT', DAY(fake, START, 'skip'), { skip: true }],
    ['PUT', DAY(fake, START, 'dish'), { dishId: fake }],
    ['POST', `${PLAN(fake)}/save`, {}],
    ['POST', `${PLAN(fake)}/recall`, {}],
    ['POST', `${PLAN(fake)}/shopping-list`, {}],
  ];

  it('未ログインは 401', async () => {
    const anon = mealPlanClient(deps);
    for (const [method, path, body] of calls) {
      expect((await anon.call(method, path, { body })).status, `${method} ${path}`).toBe(401);
    }
  });

  it('グループがない人は 403', async () => {
    const s = await register(deps, {
      email: 'loner-mealplan@example.com',
      password: 'password-1234',
      displayName: 'l',
    });
    const loner = mealPlanClient(deps, s.token);
    expect((await loner.get('/api/meal-plans/current')).status).toBe(403);
    expect((await loner.post('/api/meal-plans')).status).toBe(403);
  });

  it('合言葉（CSRF）か Origin がない状態を変える操作は拒否され、何も変わらない', async () => {
    const m = await member('csrf');
    const id = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan.planId;
    const before = (await m.api.get(PLAN(id))).body;
    for (const opt of [{ csrf: false }, { origin: false }]) {
      const writes: [string, string, unknown][] = [
        ['POST', '/api/meal-plans', { startDate: START }],
        ['POST', `${PLAN(id)}/redo`, {}],
        ['POST', DAY(id, START, 'redo'), {}],
        ['PUT', DAY(id, START, 'skip'), { skip: true }],
        ['POST', `${PLAN(id)}/save`, {}],
        ['POST', `${PLAN(id)}/shopping-list`, {}],
      ];
      for (const [method, path, body] of writes) {
        expect((await m.api.call(method, path, { body, ...opt })).status, `${method} ${path}`).toBe(
          403,
        );
      }
    }
    expect((await m.api.get(PLAN(id))).body).toEqual(before);
    expect((await m.api.get('/api/meal-plans/current')).body.plan.planId).toBe(id);
  });

  it('許可されていないメソッド・存在しない道は 404', async () => {
    const m = await member('nf');
    expect((await m.api.call('DELETE', '/api/meal-plans/current')).status).toBe(405);
    expect((await m.api.get('/api/meal-plans/x/y/z')).status).toBe(404);
  });
});

describe('提案・取得', () => {
  it('提案は 201 で 7 日分を返し、現在の献立として読める。初期データだけで空欄 0（AC9.1.6）', async () => {
    const m = await member('propose');
    expect((await m.api.get('/api/meal-plans/current')).body).toEqual({ plan: null });
    const res = await m.api.post('/api/meal-plans', { startDate: START });
    expect(res.status).toBe(201);
    const plan = res.body.plan;
    expect(plan.days).toHaveLength(7);
    expect(plan.emptyCount).toBe(0);
    expect(plan.isSaved).toBe(false);
    expect(plan.days[0]).toMatchObject({ date: START, dayStatus: 'assigned', origin: 'suggested' });
    expect(res.body.notices).toEqual([]);
    expect((await m.api.get('/api/meal-plans/current')).body.plan.planId).toBe(plan.planId);
    expect((await m.api.get(PLAN(plan.planId))).body.plan).toEqual(plan);
  });

  it('不正な入力は 400。planId の形が正しくなければ 404', async () => {
    const m = await member('bad');
    const bad = await m.api.post('/api/meal-plans', { startDate: '2026-13-01' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.startDate).toBeTruthy();
    expect((await m.api.get(PLAN('abc'))).status).toBe(404);
    const id = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan.planId;
    expect((await m.api.put(DAY(id, START, 'skip'), { skip: 'yes' })).status).toBe(400);
    expect((await m.api.put(DAY(id, START, 'dish'), {})).status).toBe(400);
    expect((await m.api.post(`${PLAN(id)}/save`, { name: 'あ'.repeat(51) })).status).toBe(400);
  });
});

describe('やり直し・作らない日・割り当て', () => {
  it('日のやり直しは他の日を動かさない。作らない日は断る（409）', async () => {
    const m = await member('redo');
    const plan = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan;
    const res = await m.api.post(DAY(plan.planId, '2026-03-04', 'redo'));
    expect(res.status).toBe(200);
    res.body.plan.days.forEach((d: { dish: { dishId: string } }, i: number) => {
      if (i === 2) expect(d.dish.dishId).not.toBe(plan.days[i].dish.dishId);
      else expect(d).toEqual(plan.days[i]);
    });
    await m.api.put(DAY(plan.planId, START, 'skip'), { skip: true });
    const refused = await m.api.post(DAY(plan.planId, START, 'redo'));
    expect(refused.status).toBe(409);
    // 競合の種類は error.code に出る（買い物リストの API と同じ形）
    expect(refused.body.error.code).toBe('DAY_IS_SKIP');
    expect(refused.body.error.message).toContain('作らない日はやり直せません');
  });

  it('週全体のやり直しは作らない日を保ち、並びを変える', async () => {
    const m = await member('redoweek');
    const plan = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan;
    await m.api.put(DAY(plan.planId, '2026-03-03', 'skip'), { skip: true });
    const before = (await m.api.get(PLAN(plan.planId))).body.plan;
    const after = (await m.api.post(`${PLAN(plan.planId)}/redo`)).body.plan;
    expect(after.days[1].dayStatus).toBe('skip');
    expect(after.days.map((d: { dish: unknown }) => d.dish)).not.toEqual(
      before.days.map((d: { dish: unknown }) => d.dish),
    );
  });

  it('「作らない」の設定と解除（結果の値を指定。繰り返しても同じ）', async () => {
    const m = await member('skip');
    const plan = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan;
    const on1 = await m.api.put(DAY(plan.planId, START, 'skip'), { skip: true });
    const on2 = await m.api.put(DAY(plan.planId, START, 'skip'), { skip: true });
    expect(on1.body).toEqual(on2.body);
    expect(on1.body.plan.skipCount).toBe(1);
    const off = await m.api.put(DAY(plan.planId, START, 'skip'), { skip: false });
    expect(off.body.plan.days[0]).toMatchObject({
      dayStatus: 'empty',
      emptyReason: 'not_proposed',
    });
    expect(off.body.plan.emptyCount).toBe(1);
  });

  it('「選んだもの」を割り当て候補として読み、日に割り当てる。3 回目は 409', async () => {
    const m = await member('assign');
    expect((await m.api.get('/api/meal-plans/assignable')).body).toEqual({ dishes: [] });
    const plan = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan;
    const used = plan.days.map((d: { dish: { dishId: string } }) => d.dish.dishId);
    const target = (await listHouseholdDishes(deps, m.ctx)).find((d) => !used.includes(d.dishId))!;
    await pick(deps, m.ctx, target.dishId);
    const cands = (await m.api.get('/api/meal-plans/assignable')).body.dishes;
    expect(cands.map((d: { dishId: string }) => d.dishId)).toEqual([target.dishId]);
    const ok = await m.api.put(DAY(plan.planId, START, 'dish'), { dishId: target.dishId });
    expect(ok.status).toBe(200);
    expect(ok.body.plan.days[0]).toMatchObject({
      dayStatus: 'assigned',
      origin: 'assigned_by_user',
    });
    expect(
      (await m.api.put(DAY(plan.planId, '2026-03-03', 'dish'), { dishId: target.dishId })).status,
    ).toBe(200);
    const third = await m.api.put(DAY(plan.planId, '2026-03-04', 'dish'), {
      dishId: target.dishId,
    });
    expect(third.status).toBe(409);
    expect(third.body.error.message).toContain('2 回まで');
  });
});

describe('保存・呼び出し・買い物リスト', () => {
  it('保存すると変更が 409 で断られ、呼び出すと写しが作業中になる。元は変わらない', async () => {
    const m = await member('save');
    const plan = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan;
    const saved = await m.api.post(`${PLAN(plan.planId)}/save`, { name: '今週' });
    expect(saved.body.plan).toMatchObject({ isSaved: true, name: '今週' });
    expect((await m.api.get('/api/meal-plans/current')).body).toEqual({ plan: null });
    const list = (await m.api.get('/api/meal-plans')).body.plans;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ planId: plan.planId, name: '今週', startDate: START });
    for (const res of [
      await m.api.put(DAY(plan.planId, START, 'skip'), { skip: true }),
      await m.api.post(DAY(plan.planId, START, 'redo')),
      await m.api.post(`${PLAN(plan.planId)}/redo`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PLAN_SAVED');
      expect(res.body.error.message).toContain('保存した献立は変更できません');
    }
    const recalled = await m.api.post(`${PLAN(plan.planId)}/recall`);
    expect(recalled.status).toBe(201);
    expect(recalled.body.plan.planId).not.toBe(plan.planId);
    expect(recalled.body.plan.isSaved).toBe(false);
    expect(recalled.body.plan.days).toEqual(saved.body.plan.days);
    expect((await m.api.get(PLAN(plan.planId))).body.plan).toEqual(saved.body.plan);
  });

  it('V10：作らない日の料理の材料は、買い物リストに渡されない。リストは献立用として作られる', async () => {
    const m = await member('shop');
    const plan = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan;
    const dishes = await listHouseholdDishes(deps, m.ctx);
    const skipDish = dishes.find((d) => d.dishId === plan.days[1].dish.dishId)!;
    await m.api.put(DAY(plan.planId, '2026-03-03', 'skip'), { skip: true });
    const res = await m.api.post(`${PLAN(plan.planId)}/shopping-list`);
    expect(res.status).toBe(200);
    expect(res.body.list.source).toBe('mealPlan');
    expect(res.body.list.planId).toBe(plan.planId);
    expect(res.body.list.items.length).toBeGreaterThan(0);
    const fromSkipped = res.body.list.items.filter((i: { dishes: { dishId: string }[] }) =>
      i.dishes.some((x) => x.dishId === skipDish.dishId),
    );
    // 他の日にも同じ料理が入っていない（提案は同じ料理 1 回まで）ので、作らない日の料理は 1 行も出ない
    expect(fromSkipped).toEqual([]);
  });

  it('料理がある日がなければ 409', async () => {
    const m = await member('noshop');
    const plan = (await m.api.post('/api/meal-plans', { startDate: START })).body.plan;
    for (const d of plan.days) await m.api.put(DAY(plan.planId, d.date, 'skip'), { skip: true });
    const res = await m.api.post(`${PLAN(plan.planId)}/shopping-list`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_INGREDIENTS');
  });
});

describe('他のグループ', () => {
  it('他のグループの献立は、読む・変える・保存する・呼び出す・買い物リストを作る、すべて 404 で、何も変わらない', async () => {
    const a = await member('scope-a');
    const b = await member('scope-b');
    // 保存済みを 1 件作ってから、作業中を 1 件作る
    const first = (await a.api.post('/api/meal-plans', { startDate: START })).body.plan;
    const saved = (await a.api.post(`${PLAN(first.planId)}/save`)).body.plan;
    const plan = (await a.api.post('/api/meal-plans', { startDate: START })).body.plan;
    const mine = (await listHouseholdDishes(deps, b.ctx))[0];
    for (const planId of [plan.planId, saved.planId]) {
      const calls: [string, string, unknown][] = [
        ['GET', PLAN(planId), undefined],
        ['POST', `${PLAN(planId)}/redo`, {}],
        ['POST', DAY(planId, START, 'redo'), {}],
        ['PUT', DAY(planId, START, 'skip'), { skip: true }],
        ['PUT', DAY(planId, START, 'dish'), { dishId: mine.dishId }],
        ['POST', `${PLAN(planId)}/save`, {}],
        ['POST', `${PLAN(planId)}/recall`, {}],
        ['POST', `${PLAN(planId)}/shopping-list`, {}],
      ];
      for (const [method, path, body] of calls) {
        expect((await b.api.call(method, path, { body })).status, `${method} ${path}`).toBe(404);
      }
    }
    expect((await b.api.get('/api/meal-plans/current')).body).toEqual({ plan: null });
    expect((await b.api.get('/api/meal-plans')).body).toEqual({ plans: [] });
    expect((await a.api.get('/api/meal-plans/current')).body.plan.planId).toBe(plan.planId);
    expect((await a.api.get(PLAN(saved.planId))).body.plan.isSaved).toBe(true);
  });
});
