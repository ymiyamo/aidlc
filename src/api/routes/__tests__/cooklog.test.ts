import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { register } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { createDish } from '@/domain/dish';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import { cooklogClient } from './cooklog-harness';

let deps: AppDeps;
let clock: TestClock;
beforeAll(async () => {
  ({ deps, clock } = await createTestDeps());
  clock.current = new Date('2026-10-10T12:00:00Z');
});
afterAll(async () => {
  await deps.db.close();
});

/** ログイン済みでグループもあるクライアントと、料理 1 件 */
async function member(label = 'm') {
  const h = await registerWithHousehold(deps, label);
  const dish = await createDish(deps, h.ctx, {
    name: '肉じゃが',
    url: `https://example.com/${label}`,
  });
  return { ...h, dish, api: cooklogClient(deps, h.session.token) };
}

describe('入口：未ログイン・グループなし・CSRF', () => {
  const calls: [string, string, unknown][] = [
    ['GET', '/api/records', undefined],
    ['POST', '/api/records', { dishId: 'x', cookedOn: '2026-10-01' }],
    ['PUT', `/api/records/${crypto.randomUUID()}`, { cookedOn: '2026-10-01' }],
    ['DELETE', `/api/records/${crypto.randomUUID()}`, undefined],
    ['GET', `/api/dishes/${crypto.randomUUID()}/records`, undefined],
  ];

  it('未ログインは 401', async () => {
    const anon = cooklogClient(deps);
    for (const [method, path, body] of calls) {
      expect((await anon.call(method, path, { body })).status, `${method} ${path}`).toBe(401);
    }
  });

  it('グループがない人は 403', async () => {
    const s = await register(deps, {
      email: 'loner-cook@example.com',
      password: 'password-1234',
      displayName: 'l',
    });
    const loner = cooklogClient(deps, s.token);
    expect((await loner.get('/api/records')).status).toBe(403);
    expect((await loner.post('/api/records', {})).status).toBe(403);
  });

  it('合言葉（CSRF）か Origin がない状態を変える操作は拒否される', async () => {
    const m = await member('csrf');
    const body = { dishId: m.dish.dishId, cookedOn: '2026-10-01' };
    expect((await m.api.call('POST', '/api/records', { body, csrf: false })).status).toBe(403);
    expect((await m.api.call('POST', '/api/records', { body, origin: false })).status).toBe(403);
    expect((await m.api.get('/api/records?month=2026-10')).body.records).toEqual([]);
  });
});

describe('追加・一覧・編集・削除', () => {
  it('追加（201）→ 月の取得 → 料理ごとの一覧 → 編集 → 削除の流れ', async () => {
    const m = await member('flow');
    const add = await m.api.post('/api/records', {
      dishId: m.dish.dishId,
      cookedOn: '2026-10-03',
      impression: 'again',
      cautionMemo: '弱火で',
    });
    expect(add.status).toBe(201);
    const rec = add.body.record;
    expect(rec).toMatchObject({
      dishName: '肉じゃが',
      cookedOn: '2026-10-03',
      impression: 'again',
      cautionMemo: '弱火で',
      memberLabel: 'flow',
    });

    const month = await m.api.get('/api/records?month=2026-10');
    expect(month.status).toBe(200);
    expect(month.body.days).toEqual([
      { date: '2026-10-03', count: 1, label: '肉じゃが', impression: 'again' },
    ]);
    expect(month.body.records).toHaveLength(1);

    const byDish = await m.api.get(`/api/dishes/${m.dish.dishId}/records`);
    expect(byDish.body.count).toBe(1);

    const edit = await m.api.put(`/api/records/${rec.recordId}`, {
      cookedOn: '2026-10-04',
      impression: '',
      cautionMemo: '',
    });
    expect(edit.status).toBe(200);
    expect(edit.body.record).toMatchObject({ cookedOn: '2026-10-04', impression: null });

    expect((await m.api.del(`/api/records/${rec.recordId}`)).status).toBe(200);
    expect((await m.api.get('/api/records?month=2026-10')).body.records).toEqual([]);
    expect((await m.api.del(`/api/records/${rec.recordId}`)).status).toBe(404);
  });

  it('月を省くと今月。月の形が違えば 400', async () => {
    const m = await member('mon');
    expect((await m.api.get('/api/records')).body.month).toBe('2026-10');
    const bad = await m.api.get('/api/records?month=2026-99');
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toHaveProperty('month');
  });
});

describe('エラー（BR40.1〜BR40.5）', () => {
  it('未来の日付は 400 と FUTURE_DATE_NOT_ALLOWED', async () => {
    const m = await member('fut');
    const r = await m.api.post('/api/records', { dishId: m.dish.dishId, cookedOn: '2026-10-11' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({
      code: 'FUTURE_DATE_NOT_ALLOWED',
      fields: { cookedOn: '未来の日付は選べません' },
    });
  });

  it('不正な日付・感想は 400（項目ごとのエラー）', async () => {
    const m = await member('bad');
    const r = await m.api.post('/api/records', {
      dishId: m.dish.dishId,
      cookedOn: '2026-02-30',
      impression: 'maybe',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation');
    expect(Object.keys(r.body.error.fields).sort()).toEqual(['cookedOn', 'impression']);
    expect(
      (await m.api.post('/api/records', { dishId: m.dish.dishId, cookedOn: 20261001 })).status,
    ).toBe(400);
  });

  it('同じ料理の同じ日は 409 と DUPLICATE_RECORD。既存の recordId が分かる', async () => {
    const m = await member('dup');
    const first = await m.api.post('/api/records', {
      dishId: m.dish.dishId,
      cookedOn: '2026-10-01',
    });
    const second = await m.api.post('/api/records', {
      dishId: m.dish.dishId,
      cookedOn: '2026-10-01',
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'DUPLICATE_RECORD',
      existingRecordId: first.body.record.recordId,
    });
  });
});

describe('他のグループ（ADR-005）', () => {
  it('他のグループの料理・記録は、追加も編集も削除も一覧も 404', async () => {
    const a = await member('ga');
    const b = await member('gb');
    const rec = (
      await a.api.post('/api/records', { dishId: a.dish.dishId, cookedOn: '2026-10-01' })
    ).body.record;

    const foreignAdd = await b.api.post('/api/records', {
      dishId: a.dish.dishId,
      cookedOn: '2026-10-02',
    });
    expect(foreignAdd.status).toBe(404);
    expect(
      (await b.api.put(`/api/records/${rec.recordId}`, { cookedOn: '2026-10-02' })).status,
    ).toBe(404);
    expect((await b.api.del(`/api/records/${rec.recordId}`)).status).toBe(404);
    expect((await b.api.get(`/api/dishes/${a.dish.dishId}/records`)).status).toBe(404);
    expect((await b.api.get('/api/records?month=2026-10')).body.records).toEqual([]);
    // 持ち主の記録は無傷
    expect((await a.api.get('/api/records?month=2026-10')).body.records).toHaveLength(1);
  });

  it('形の違う ID は 404', async () => {
    const m = await member('badid');
    expect((await m.api.put('/api/records/not-an-id', { cookedOn: '2026-10-01' })).status).toBe(
      404,
    );
    expect((await m.api.del('/api/records/not-an-id')).status).toBe(404);
    expect((await m.api.get('/api/dishes/not-an-id/records')).status).toBe(404);
  });
});
