import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handle } from '@/api/router';
import { SESSION_COOKIE } from '@/api/http';
import { register } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { createDish, removeDish } from '@/domain/dish';
import { listDishes } from '@/repo/dishes';
import { addDislike } from '@/domain/taste';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import { tasteClient } from './taste-harness';

let deps: AppDeps;
beforeAll(async () => {
  ({ deps } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

const ing = (...names: string[]) => names.map((name) => ({ name, amount: null, unit: null }));
let urlSeq = 0;

/** 初期データなしの、ログイン済みのグループ（クライアント付き） */
async function member(label = 'm') {
  const h = await registerWithHousehold(deps, label);
  for (const d of await listDishes(deps.db, h.householdId)) await removeDish(deps, h.ctx, d.dishId);
  const addDish = (name: string, over: Record<string, unknown> = {}) =>
    createDish(deps, h.ctx, { name, url: `https://example.com/t${(urlSeq += 1)}`, ...over });
  return { ...h, api: tasteClient(deps, h.session.token), addDish };
}

/** 入口（router.ts）を通した GET。絞り込みつきの候補は、既存の GET /api/suggestions/next が受け持つ */
async function viaRouter(token: string, path: string) {
  const res = await handle(
    new Request(`http://localhost${path}`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: 'http://localhost' },
    }),
    deps,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('入口：未ログイン・グループなし・CSRF', () => {
  const calls: [string, string, unknown][] = [
    ['GET', '/api/me/dislikes', undefined],
    ['POST', '/api/me/dislikes', { ingredientName: 'えび' }],
    ['DELETE', `/api/me/dislikes/${randomUUID()}`, undefined],
    ['GET', '/api/suggestions/count', undefined],
    ['GET', '/api/suggestions/mood-tags', undefined],
    ['GET', '/api/suggestions/random', undefined],
  ];

  it('未ログインは 401', async () => {
    const anon = tasteClient(deps);
    for (const [method, path, body] of calls) {
      expect((await anon.call(method, path, { body })).status, `${method} ${path}`).toBe(401);
    }
  });

  it('グループがない人は 403', async () => {
    const s = await register(deps, {
      email: 'loner-taste@example.com',
      password: 'password-1234',
      displayName: 'l',
    });
    const loner = tasteClient(deps, s.token);
    for (const [method, path, body] of calls) {
      expect((await loner.call(method, path, { body })).status, `${method} ${path}`).toBe(403);
    }
  });

  it('合言葉（CSRF）か Origin がない状態を変える操作は拒否され、何も登録されない', async () => {
    const m = await member('csrf');
    const body = { ingredientName: 'えび' };
    expect((await m.api.call('POST', '/api/me/dislikes', { body, csrf: false })).status).toBe(403);
    expect((await m.api.call('POST', '/api/me/dislikes', { body, origin: false })).status).toBe(
      403,
    );
    const ok = (await m.api.post('/api/me/dislikes', body)).body.dislike;
    expect((await m.api.call('DELETE', `/api/me/dislikes/${ok.id}`, { csrf: false })).status).toBe(
      403,
    );
    expect(
      (await m.api.call('DELETE', `/api/me/dislikes/${ok.id}`, { origin: false })).status,
    ).toBe(403);
    expect((await m.api.get('/api/me/dislikes')).body.dislikes).toHaveLength(1);
  });
});

describe('嫌いな食材の登録・一覧・解除', () => {
  it('登録（201）→ 一覧 → 同じ食材の再登録（200、増えない）→ 解除 → 空', async () => {
    const m = await member('flow');
    const add = await m.api.post('/api/me/dislikes', { ingredientName: ' えび ' });
    expect(add.status).toBe(201);
    expect(add.body.dislike).toMatchObject({ ingredientName: 'えび' });

    const again = await m.api.post('/api/me/dislikes', { ingredientName: 'えび' });
    expect(again.status).toBe(200);
    expect(again.body.dislike.id).toBe(add.body.dislike.id);

    const list = await m.api.get('/api/me/dislikes');
    expect(list.status).toBe(200);
    expect(list.body.dislikes).toHaveLength(1);
    expect(list.body.limit).toBe(50);

    const del = await m.api.del(`/api/me/dislikes/${add.body.dislike.id}`);
    expect(del.status).toBe(200);
    expect((await m.api.get('/api/me/dislikes')).body.dislikes).toEqual([]);
  });

  it.each([
    ['空', { ingredientName: '' }],
    ['51 文字', { ingredientName: 'あ'.repeat(51) }],
    ['項目なし', {}],
  ])('不正な食材名は 400（項目つき）：%s', async (_label, body) => {
    const m = await member('inval');
    const r = await m.api.post('/api/me/dislikes', body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation');
    expect(r.body.error.fields.ingredientName).toBe('食材名は 1〜50 文字で入力してください');
    expect((await m.api.get('/api/me/dislikes')).body.dislikes).toEqual([]);
  });

  it('51 件目は 400 で、使わないものを外すよう案内する', async () => {
    const m = await member('limit');
    for (let i = 0; i < 50; i++) {
      expect((await m.api.post('/api/me/dislikes', { ingredientName: `食材${i}` })).status).toBe(
        201,
      );
    }
    const r = await m.api.post('/api/me/dislikes', { ingredientName: 'もう一つ' });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.ingredientName).toContain('50 件まで');
  });

  it('グループは入口で決めた値だけ。本文の householdId・memberId は無視される（BR10.23）', async () => {
    const a = await member('own-a');
    const b = await member('own-b');
    const r = await a.api.post('/api/me/dislikes', {
      ingredientName: 'えび',
      householdId: b.householdId,
      memberId: b.memberId,
    });
    expect(r.status).toBe(201);
    expect((await a.api.get('/api/me/dislikes')).body.dislikes).toHaveLength(1);
    expect((await b.api.get('/api/me/dislikes')).body.dislikes).toEqual([]);
  });

  it('他のグループの登録は一覧に出ず、外せず（404）、何も変わらない', async () => {
    const a = await member('iso-a');
    const b = await member('iso-b');
    const mine = (await a.api.post('/api/me/dislikes', { ingredientName: 'えび' })).body.dislike;
    expect((await b.api.get('/api/me/dislikes')).body.dislikes).toEqual([]);
    const r = await b.api.del(`/api/me/dislikes/${mine.id}`);
    expect(r.status).toBe(404);
    expect((await a.api.get('/api/me/dislikes')).body.dislikes).toHaveLength(1);
  });

  it('同じグループの家族の登録も、一覧に出ず、外せない（404）', async () => {
    const a = await member('fam-a');
    const familyId = randomUUID();
    await deps.db.query(
      'insert into members (member_id, household_id, display_name) values ($1,$2,$3)',
      [familyId, a.householdId, 'f'],
    );
    const theirs = (
      await addDislike(
        deps,
        { householdId: a.householdId, memberId: familyId },
        { ingredientName: 'セロリ' },
      )
    ).dislike;
    expect((await a.api.get('/api/me/dislikes')).body.dislikes).toEqual([]);
    expect((await a.api.del(`/api/me/dislikes/${theirs.id}`)).status).toBe(404);
  });

  it('存在しない ID・形の違う ID の解除は 404', async () => {
    const m = await member('rm404');
    expect((await m.api.del(`/api/me/dislikes/${randomUUID()}`)).status).toBe(404);
    expect((await m.api.del('/api/me/dislikes/not-a-uuid')).status).toBe(404);
  });
});

describe('件数・気分のタグ・おまかせ', () => {
  it('条件に合う件数（除外後）を返す。条件なしは全件', async () => {
    const m = await member('count');
    await m.addDish('速い', { cookTime: 'within15', effort: 'easy', ingredients: ing('卵') });
    await m.addDish('えび速い', { cookTime: 'within15', effort: 'easy', ingredients: ing('えび') });
    await m.addDish('遅い', { cookTime: 'over30', effort: 'hard', ingredients: ing('卵') });
    expect((await m.api.get('/api/suggestions/count')).body).toEqual({ count: 3 });
    expect((await m.api.get('/api/suggestions/count?time=within15&effort=easy')).body.count).toBe(
      2,
    );
    await m.api.post('/api/me/dislikes', { ingredientName: 'えび' });
    expect((await m.api.get('/api/suggestions/count?time=within15&effort=easy')).body.count).toBe(
      1,
    );
    expect((await m.api.get('/api/suggestions/count')).body.count).toBe(2);
    expect((await m.api.get('/api/suggestions/count?time=over30&effort=easy')).body.count).toBe(0);
  });

  it('件数：気分のタグは繰り返しで渡す（どれか 1 つでも付いていれば合う）', async () => {
    const m = await member('count2');
    await m.addDish('a', { moodTags: ['さっぱり'] });
    await m.addDish('b', { moodTags: ['がっつり'] });
    await m.addDish('c', { moodTags: ['こってり'] });
    const r = await m.api.get(
      `/api/suggestions/count?moodTag=${encodeURIComponent('さっぱり')}&moodTag=${encodeURIComponent('がっつり')}`,
    );
    expect(r.body.count).toBe(2);
  });

  it.each(['time=longer', 'effort=impossible', `moodTag=${encodeURIComponent('あ'.repeat(21))}`])(
    '不正な条件は 400：%s',
    async (qs) => {
      const m = await member('badq');
      const r = await m.api.get(`/api/suggestions/count?${qs}`);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('validation');
    },
  );

  it('他のグループの料理は数えない', async () => {
    const a = await member('cnt-a');
    const b = await member('cnt-b');
    await a.addDish('a');
    await b.addDish('b1');
    await b.addDish('b2');
    expect((await a.api.get('/api/suggestions/count')).body.count).toBe(1);
    expect((await b.api.get('/api/suggestions/count')).body.count).toBe(2);
  });

  it('気分のタグの選択肢：自分のグループの料理のタグだけ', async () => {
    const a = await member('tags-a');
    const b = await member('tags-b');
    await a.addDish('a', { moodTags: ['さっぱり', 'がっつり'] });
    await b.addDish('b', { moodTags: ['よそ'] });
    expect((await a.api.get('/api/suggestions/mood-tags')).body).toEqual({
      tags: ['がっつり', 'さっぱり'],
    });
  });

  it('おまかせ：除外だけ適用して 1 件。全部外れたら all_excluded、保存 0 件なら empty', async () => {
    const m = await member('rand');
    expect((await m.api.get('/api/suggestions/random')).body).toEqual({ status: 'empty' });
    await m.addDish('えびチリ', { ingredients: ing('えび') });
    expect((await m.api.get('/api/suggestions/random')).body).toMatchObject({
      status: 'card',
      dish: { name: 'えびチリ' },
    });
    await m.api.post('/api/me/dislikes', { ingredientName: 'えび' });
    expect((await m.api.get('/api/suggestions/random')).body).toEqual({ status: 'all_excluded' });
    await m.addDish('ご飯', { ingredients: ing('米') });
    expect((await m.api.get('/api/suggestions/random')).body).toMatchObject({
      status: 'card',
      dish: { name: 'ご飯' },
    });
  });
});

describe('候補の取得（既存の GET /api/suggestions/next）に絞り込みと除外が効く', () => {
  it('条件なしは U1 のまま。除外の登録があれば、その材料の料理は出ない', async () => {
    const m = await member('next1');
    await m.addDish('えびチリ', { ingredients: ing('えび') });
    await m.addDish('ご飯', { ingredients: ing('米') });
    await m.api.post('/api/me/dislikes', { ingredientName: 'えび' });
    const r = await viaRouter(m.session.token, '/api/suggestions/next');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'card', dish: { name: 'ご飯' }, remaining: 0 });
  });

  it('time と effort の両方に合う料理だけ。0 件なら no_match、除外で全部外れたら all_excluded', async () => {
    const m = await member('next2');
    await m.addDish('速くて楽', { cookTime: 'within15', effort: 'easy', ingredients: ing('卵') });
    await m.addDish('速いが大変', { cookTime: 'within15', effort: 'hard', ingredients: ing('卵') });
    const hit = await viaRouter(m.session.token, '/api/suggestions/next?time=within15&effort=easy');
    expect(hit.body).toMatchObject({ status: 'card', dish: { name: '速くて楽' } });
    const miss = await viaRouter(m.session.token, '/api/suggestions/next?time=over30');
    expect(miss.body).toEqual({ status: 'no_match' });
    await m.api.post('/api/me/dislikes', { ingredientName: '卵' });
    expect((await viaRouter(m.session.token, '/api/suggestions/next')).body).toEqual({
      status: 'all_excluded',
    });
  });

  it('気分のタグ（moodTag の繰り返し）と、見た料理（seen）を同時に使える', async () => {
    const m = await member('next3');
    const a = await m.addDish('a', { moodTags: ['さっぱり'] });
    await m.addDish('b', { moodTags: ['がっつり'] });
    const q = `moodTag=${encodeURIComponent('さっぱり')}`;
    const first = await viaRouter(m.session.token, `/api/suggestions/next?${q}`);
    expect(first.body).toMatchObject({ status: 'card', dish: { name: 'a' } });
    const second = await viaRouter(m.session.token, `/api/suggestions/next?${q}&seen=${a.dishId}`);
    expect(second.body).toEqual({ status: 'done' });
  });

  it('不正な条件は 400（選択肢以外の値）', async () => {
    const m = await member('next4');
    const r = await viaRouter(m.session.token, '/api/suggestions/next?time=longer');
    expect(r.status).toBe(400);
    expect(r.body.error.fields.time).toContain('選択肢');
  });

  it('他のグループの嫌いな食材・料理は影響しない', async () => {
    const a = await member('next5-a');
    const b = await member('next5-b');
    await a.addDish('えびチリ', { ingredients: ing('えび') });
    await b.api.post('/api/me/dislikes', { ingredientName: 'えび' });
    expect((await viaRouter(a.session.token, '/api/suggestions/next')).body).toMatchObject({
      status: 'card',
      dish: { name: 'えびチリ' },
    });
  });
});
