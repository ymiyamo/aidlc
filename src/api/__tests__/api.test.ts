import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as healthz } from '@/app/healthz/route';
import { parseCookies } from '@/api/http';
import type { AppDeps } from '@/domain/deps';
import { createLogger } from '@/lib/logger';
import { createClient, type TestClient } from '@/test-helpers/client';
import { createTestDeps, type TestClock } from '@/test-helpers/deps';

let deps: AppDeps;
let clock: TestClock;
const logLines: string[] = [];

beforeAll(async () => {
  ({ deps, clock } = await createTestDeps({ logger: createLogger((l) => logLines.push(l)) }));
});
afterAll(async () => {
  await deps.db.close();
});

let n = 0;
const email = (label: string) => `${label}${++n}@example.com`;

async function householdClient(label = 'api'): Promise<TestClient> {
  const c = createClient(deps);
  const r = await c.signUpWithHousehold(email(label));
  expect(r.status).toBe(201);
  return c;
}

const dishBody = (over: Record<string, unknown> = {}) => ({
  name: 'テスト料理',
  url: `https://example.com/t/${++n}`,
  ...over,
});

describe('認証の入口（未ログイン）', () => {
  it('未ログインは 401。グループがなければ 403 no_household', async () => {
    const anon = createClient(deps);
    await anon.init();
    expect((await anon.get('/api/dishes')).status).toBe(401);
    expect((await anon.get('/api/me')).status).toBe(401);
    expect((await anon.get('/api/suggestions/next')).status).toBe(401);
    expect((await anon.post('/api/picked', { dishId: 'x' })).status).toBe(401);

    const c = createClient(deps);
    expect((await c.signUp(email('nohh'))).status).toBe(201);
    const r = await c.get('/api/dishes');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('no_household');
  });

  it('期限切れ・ログアウト後は 401', async () => {
    const c = await householdClient('lo');
    expect((await c.get('/api/dishes')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/dishes')).status).toBe(401);
  });

  it('ログイン：間違いは理由を区別せず 401', async () => {
    const e = email('login');
    const c = createClient(deps);
    await c.signUp(e);
    await c.post('/api/auth/logout');
    const bad = await c.post('/api/auth/login', { email: e, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const bad2 = await c.post('/api/auth/login', {
      email: 'x@example.com',
      password: 'wrong-password',
    });
    expect(bad2.body.error.message).toBe(bad.body.error.message);
    const ok = await c.post('/api/auth/login', { email: e, password: 'password-1234' });
    expect(ok.status).toBe(200);
  });

  it('Cookie は HttpOnly・SameSite=Lax・30 日。Secure は設定で切り替える', async () => {
    const c = createClient(deps);
    await c.init();
    const r = await c.post('/api/auth/register', { email: email('ck'), password: 'password-1234' });
    const line = r.headers.getSetCookie().find((l) => l.startsWith('mp_session='))!;
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Max-Age=2592000/);
    expect(line).not.toMatch(/Secure/);
    deps.config.cookieSecure = true;
    const r2 = await createClient(deps).post('/api/auth/logout');
    void r2;
    const c2 = createClient(deps);
    await c2.init();
    const r3 = await c2.post('/api/auth/register', {
      email: email('ck2'),
      password: 'password-1234',
    });
    expect(r3.headers.getSetCookie().find((l) => l.startsWith('mp_session='))).toMatch(/Secure/);
    deps.config.cookieSecure = false;
  });
});

describe('CSRF（NFR3.11）', () => {
  it('合言葉がなければ拒否', async () => {
    const c = createClient(deps);
    await c.init();
    const r = await c.raw('POST', '/api/auth/register', {
      body: { email: email('csrf1'), password: 'password-1234' },
      csrf: false,
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
  });

  it('Origin がなければ、または別のサイトなら拒否', async () => {
    const c = createClient(deps);
    await c.init();
    const body = { email: email('csrf2'), password: 'password-1234' };
    expect((await c.raw('POST', '/api/auth/register', { body, origin: null })).status).toBe(403);
    expect(
      (await c.raw('POST', '/api/auth/register', { body, origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await c.raw('POST', '/api/auth/register', { body })).status).toBe(201);
  });

  it('合言葉が Cookie と違えば拒否。状態を変える操作はどれも対象', async () => {
    const c = await householdClient('csrf3');
    const bad = await c.raw('POST', '/api/dishes', {
      body: dishBody(),
      headers: { 'x-csrf-token': 'forged' },
      csrf: false,
    });
    expect(bad.status).toBe(403);
    for (const [m, p] of [
      ['POST', '/api/picked'],
      ['PUT', '/api/dishes/00000000-0000-4000-8000-000000000000'],
      ['DELETE', '/api/dishes/00000000-0000-4000-8000-000000000000'],
      ['POST', '/api/home/prepare'],
    ] as const) {
      const r = await c.raw(m, p, { body: {}, csrf: false });
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });

  it('本番で APP_ORIGIN が未設定なら、状態を変える操作は拒否する。設定すれば通る', async () => {
    const c = createClient(deps);
    await c.init();
    const body = () => ({ email: email('csrf5'), password: 'password-1234' });
    const saved = { ...deps.config };
    try {
      deps.config.requireAppOrigin = true;
      deps.config.appOrigin = null;
      const denied = await c.raw('POST', '/api/auth/register', { body: body() });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('csrf');
      deps.config.appOrigin = 'http://localhost';
      expect((await c.raw('POST', '/api/auth/register', { body: body() })).status).toBe(201);
    } finally {
      Object.assign(deps.config, saved);
    }
  });

  it('壊れた Cookie の値があっても 500 にならず、その Cookie だけ無視する', async () => {
    const c = createClient(deps);
    await c.init();
    const r = await c.raw('GET', '/api/dishes', {
      headers: { cookie: 'broken=%E0%A4%A; mp_session=%' },
    });
    expect(r.status).toBe(401);
    const p = parseCookies('a=%; b=ok; c=%E0%A4%A');
    expect(p).toEqual({ b: 'ok' });
  });

  it('GET では状態を変えられない（POST 専用の経路は 405）', async () => {
    const c = await householdClient('csrf4');
    expect((await c.get('/api/home/prepare')).status).toBe(405);
    expect((await c.get('/api/auth/logout')).status).toBe(405);
  });
});

describe('入力の検証（NFR3.8）', () => {
  it('不正な入力は 400 で、項目ごとのメッセージを返す', async () => {
    const c = await householdClient('val');
    const r = await c.post('/api/dishes', {
      name: '',
      url: 'javascript:alert(1)',
      moodTags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.fields)).toEqual(
      expect.arrayContaining(['name', 'url', 'moodTags']),
    );
    expect((await c.post('/api/dishes', dishBody({ name: 'あ'.repeat(101) }))).status).toBe(400);
  });

  it('壊れた JSON は 400。登録の入力エラーも 400', async () => {
    const c = createClient(deps);
    await c.init();
    const r = await c.raw('POST', '/api/auth/register', { body: undefined, headers: {} });
    expect(r.status).toBe(400);
    const short = await c.post('/api/auth/register', {
      email: email('short'),
      password: '1234567',
    });
    expect(short.status).toBe(400);
    expect(short.body.error.fields.password).toContain('8文字以上');
  });

  it('同じメールアドレスの登録は 409', async () => {
    const e = email('dupreg');
    const a = createClient(deps);
    await a.signUp(e);
    const b = createClient(deps);
    const r = await b.signUp(e.toUpperCase());
    expect(r.status).toBe(409);
  });
});

describe('グループの範囲（BR2.3、BR2.4）', () => {
  it('他のグループの料理 ID は、読み取り・更新・削除・お気に入り・選ぶのすべてが 404', async () => {
    const a = await householdClient('scopeA');
    const b = await householdClient('scopeB');
    const saved = await a.post('/api/dishes', dishBody());
    const id = saved.body.dish.id;

    expect((await b.get(`/api/dishes/${id}`)).status).toBe(404);
    expect((await b.put(`/api/dishes/${id}`, dishBody())).status).toBe(404);
    expect((await b.put(`/api/dishes/${id}/favorite`, { isFavorite: true })).status).toBe(404);
    expect((await b.del(`/api/dishes/${id}`)).status).toBe(404);
    expect((await b.post('/api/picked', { dishId: id })).status).toBe(404);

    const list = await b.get('/api/dishes');
    expect(list.body.dishes.some((d: { id: string }) => d.id === id)).toBe(false);
    // 持ち主のデータは無傷
    const still = await a.get(`/api/dishes/${id}`);
    expect(still.status).toBe(200);
    expect(still.body.dish.isFavorite).toBe(false);
  });

  it('ID の形が不正でも 404（500 にならない）', async () => {
    const c = await householdClient('badid');
    expect((await c.get('/api/dishes/not-a-uuid')).status).toBe(404);
    expect((await c.post('/api/picked', { dishId: 'zzz' })).status).toBe(404);
  });

  it('グループは画面の入力ではなくログイン状態で決まる（body の householdId は無視される）', async () => {
    const a = await householdClient('forgeA');
    const b = await householdClient('forgeB');
    const me = await a.post(
      '/api/dishes',
      dishBody({ householdId: '00000000-0000-4000-8000-000000000001' }),
    );
    expect(me.status).toBe(201);
    const inB = await b.get('/api/dishes');
    expect(inB.body.dishes.some((d: { id: string }) => d.id === me.body.dish.id)).toBe(false);
  });
});

describe('一連の流れ（検証コマンド。NFR6.3）', () => {
  it('登録 → グループ作成 → 保存 → 候補を見て次へ → 選ぶ → 外す', async () => {
    const c = createClient(deps);
    expect((await c.signUp(email('flow'), 'password-1234', 'パパ')).status).toBe(201);
    expect((await c.get('/api/me')).body).toMatchObject({ hasHousehold: false });
    expect((await c.post('/api/household', { name: '田中家' })).status).toBe(201);

    const home = await c.post('/api/home/prepare');
    expect(home.body).toEqual({ householdName: '田中家', seedStatus: 'ready' });
    expect((await c.get('/api/dishes')).body.dishes).toHaveLength(30);
    expect((await c.get('/api/household/members')).body.members).toEqual([
      { memberId: expect.any(String), displayName: 'パパ' },
    ]);

    clock.advanceMs(60_000); // 保存の時刻を初期データより新しくする
    const saved = await c.post(
      '/api/dishes',
      dishBody({ name: '自慢のカレー', cookTime: 'over30' }),
    );
    expect(saved.status).toBe(201);
    expect((await c.get('/api/dishes')).body.dishes[0].name).toBe('自慢のカレー');

    // 候補を 1 件ずつ見る。見た ID を送ると同じ料理は出ない
    const seen: string[] = [];
    const first = await c.get('/api/suggestions/next');
    expect(first.body.status).toBe('card');
    seen.push(first.body.dish.id);
    const second = await c.get(`/api/suggestions/next?seen=${seen.join(',')}`);
    expect(second.body.status).toBe('card');
    expect(second.body.dish.id).not.toBe(first.body.dish.id);

    // 「これにする」
    expect((await c.post('/api/picked', { dishId: second.body.dish.id })).status).toBe(201);
    expect((await c.post('/api/picked', { dishId: second.body.dish.id })).status).toBe(201);
    const picked = await c.get('/api/picked');
    expect(picked.body.picked).toHaveLength(1);
    // 選んだものは候補に出ない
    for (let i = 0; i < 40; i++) {
      const r = await c.get('/api/suggestions/next');
      if (r.body.status !== 'card') break;
      expect(r.body.dish.id).not.toBe(second.body.dish.id);
    }
    expect((await c.del(`/api/picked/${second.body.dish.id}`)).status).toBe(200);
    expect((await c.get('/api/picked')).body.picked).toHaveLength(0);
  });

  it('お気に入り・編集・削除', async () => {
    const c = await householdClient('crud');
    const { dish } = (
      await c.post(
        '/api/dishes',
        dishBody({ ingredients: [{ name: '卵', amount: '2', unit: '個' }] }),
      )
    ).body;
    expect(
      (await c.put(`/api/dishes/${dish.id}/favorite`, { isFavorite: true })).body.dish.isFavorite,
    ).toBe(true);
    expect(
      (await c.get('/api/dishes?favorite=1')).body.dishes.map((d: { id: string }) => d.id),
    ).toContain(dish.id);
    expect((await c.put(`/api/dishes/${dish.id}/favorite`, { isFavorite: 'yes' })).status).toBe(
      400,
    );
    const edited = await c.put(`/api/dishes/${dish.id}`, {
      name: '改名',
      url: dish.url,
      effort: 'easy',
    });
    expect(edited.body.dish).toMatchObject({ name: '改名', effort: 'easy', ingredients: [] });
    expect((await c.del(`/api/dishes/${dish.id}`)).status).toBe(200);
    expect((await c.get(`/api/dishes/${dish.id}`)).status).toBe(404);
  });

  it('同じ URL は 409 duplicate_url で既存の料理名を返し、confirmDuplicate で保存できる', async () => {
    const c = await householdClient('dupapi');
    const body = dishBody({ name: '最初' });
    await c.post('/api/dishes', body);
    const dup = await c.post('/api/dishes', { ...body, name: '二つ目' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'duplicate_url', existing: { name: '最初' } });
    expect(
      (await c.post('/api/dishes', { ...body, name: '二つ目', confirmDuplicate: true })).status,
    ).toBe(201);
  });

  it('保存した料理が 0 件なら empty、見終えたら done', async () => {
    const c = await householdClient('emptydone');
    const list = (await c.get('/api/dishes')).body.dishes as { id: string }[];
    const keep = list[0].id;
    for (const d of list.slice(1)) await c.del(`/api/dishes/${d.id}`);
    expect((await c.get(`/api/suggestions/next?seen=${keep}`)).body.status).toBe('done');
    await c.del(`/api/dishes/${keep}`);
    expect((await c.get('/api/suggestions/next')).body.status).toBe('empty');
  });
});

describe('/healthz と共通の応答', () => {
  it('/healthz は DB に触れず固定の応答', async () => {
    const res = healthz();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('応答にリクエスト識別子が付き、キャッシュされない。知らない経路は 404', async () => {
    const c = createClient(deps);
    const r = await c.get('/api/nothing');
    expect(r.status).toBe(404);
    expect(r.headers.get('x-request-id')).toBeTruthy();
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('ログの伏せ字（NFR4.13、NFR3.14）', () => {
  it('パスワード・メール・Cookie の値・メモ・料理の URL がログに出ない', async () => {
    logLines.length = 0;
    const secretEmail = 'logcheck-secret@example.com';
    const secretPass = 'zq-secret-pass-98765';
    const secretMemo = 'ひみつのメモ-4242';
    const secretUrl = 'https://example.com/private-url-7777';
    const c = createClient(deps);
    await c.signUp(secretEmail, secretPass, 'ログ太郎');
    await c.post('/api/household', {});
    await c.post('/api/dishes', { name: 'ログ確認', url: secretUrl, memo: secretMemo });
    await c.post('/api/auth/login', { email: secretEmail, password: 'wrong-password-1' });
    const sessionValue = c.jar.get('mp_session')!;
    const csrfValue = c.jar.get('mp_csrf')!;
    expect(logLines.length).toBeGreaterThan(3);
    const all = logLines.join('\n');
    for (const secret of [
      secretEmail,
      secretPass,
      secretMemo,
      secretUrl,
      sessionValue,
      csrfValue,
      'ログ太郎',
    ]) {
      expect(all).not.toContain(secret);
    }
    for (const line of logLines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('ロガーは入れ子の項目名も伏せる', async () => {
    const lines: string[] = [];
    createLogger((l) => lines.push(l)).info('x', {
      user: { email: 'a@b.c', password: 'p' },
      ok: 1,
    });
    expect(lines[0]).not.toContain('a@b.c');
    expect(lines[0]).toContain('"ok":1');
  });
});
