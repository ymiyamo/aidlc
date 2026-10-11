import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, register } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { createLogger } from '@/lib/logger';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import { adminClient } from './harness';

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

/** ログイン済みでグループもあるクライアント */
async function member(label = 'm') {
  const h = await registerWithHousehold(deps, label);
  return { ...h, api: adminClient(deps, h.session.token) };
}
/** ログイン済みだが、グループがないクライアント */
async function loner(label = 'l') {
  const e = email(label);
  const s = await register(deps, { email: e, password: 'password-1234', displayName: label });
  return { email: e, accountId: s.accountId, api: adminClient(deps, s.token) };
}
const tokenOf = (path: string) =>
  decodeURIComponent(new URL(`http://x${path}`).searchParams.get('token')!);

describe('入口：未ログイン・グループなし・CSRF', () => {
  const protectedCalls: [string, string, unknown][] = [
    ['POST', '/api/invitations', {}],
    ['POST', '/api/invitations/join', { token: 'x' }],
    ['GET', '/api/admin/overview', undefined],
    ['POST', '/api/household/leave', { confirm: true }],
    ['POST', '/api/account/delete', { confirm: true, password: 'x' }],
  ];

  it('未ログインは 401', async () => {
    const anon = adminClient(deps);
    for (const [method, path, body] of protectedCalls) {
      const r = await anon.call(method, path, { body });
      expect(r.status, `${method} ${path}`).toBe(401);
    }
  });

  it('グループがない人は、招待の発行と設定の取得ができない（403）', async () => {
    const l = await loner();
    expect((await l.api.post('/api/invitations')).status).toBe(403);
    expect((await l.api.get('/api/admin/overview')).status).toBe(403);
  });

  it('合言葉（CSRF）か Origin がない状態を変える操作は拒否される', async () => {
    const m = await member();
    expect((await m.api.call('POST', '/api/invitations', { body: {}, csrf: false })).status).toBe(
      403,
    );
    expect((await m.api.call('POST', '/api/invitations', { body: {}, origin: false })).status).toBe(
      403,
    );
    expect(
      (
        await adminClient(deps).call('POST', '/api/password-reset/request', {
          body: { email: 'a@example.com' },
          csrf: false,
        })
      ).status,
    ).toBe(403);
    // 拒否されたので、何も作られていない
    const inv = await deps.db.query('select 1 from invitations where household_id = $1', [
      m.householdId,
    ]);
    expect(inv.rows).toHaveLength(0);
  });

  it('許可されていない操作（GET で発行など）は見つからない', async () => {
    const m = await member();
    expect((await m.api.get('/api/invitations')).status).toBe(404);
  });
});

describe('招待の発行・確認・参加', () => {
  it('発行したリンクを、別の人が開いて参加できる。参加後は共有内容の所属になる', async () => {
    const owner = await member('owner');
    const issued = await owner.api.post('/api/invitations');
    expect(issued.status).toBe(201);
    expect(issued.body.path).toMatch(/^\/join\?token=/);

    const guest = await loner('guest');
    const token = tokenOf(issued.body.path);
    // ログイン前でも、グループ名だけ確認できる
    const preview = await adminClient(deps).post('/api/invitations/preview', { token });
    expect(preview.body).toEqual({ status: 'valid', householdName: 'owner' });
    const joined = await guest.api.post('/api/invitations/join', { token, displayName: 'ゲスト' });
    expect(joined.status).toBe(201);
    const overview = await guest.api.get('/api/admin/overview');
    expect(overview.body).toEqual({ householdName: 'owner', activeMemberCount: 2 });
  });

  it('リンクの再利用は「使えません」。確認でも使用済みと分かる', async () => {
    const owner = await member('owner');
    const token = tokenOf((await owner.api.post('/api/invitations')).body.path);
    const a = await loner('a');
    const b = await loner('b');
    expect((await a.api.post('/api/invitations/join', { token })).status).toBe(201);
    const again = await b.api.post('/api/invitations/join', { token });
    expect(again.status).toBe(404);
    expect(again.body.error.message).toContain('使えません');
    expect((await adminClient(deps).post('/api/invitations/preview', { token })).body).toEqual({
      status: 'unusable',
    });
  });

  it('期限切れは 410。確認では expired', async () => {
    const owner = await member('owner');
    const token = tokenOf((await owner.api.post('/api/invitations')).body.path);
    const guest = await loner('late');
    clock.advanceMs(7 * 24 * 60 * 60 * 1000);
    const r = await guest.api.post('/api/invitations/join', { token });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('expired');
    expect((await adminClient(deps).post('/api/invitations/preview', { token })).body).toEqual({
      status: 'expired',
    });
  });

  it('他のグループの人は、自分のグループの招待にならない。すでにグループにいる人は参加できない', async () => {
    const a = await member('grp-a');
    const b = await member('grp-b');
    const token = tokenOf((await a.api.post('/api/invitations')).body.path);
    const r = await b.api.post('/api/invitations/join', { token, householdId: a.householdId });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('先に今のグループから抜けてください');
  });

  it('10 本を超える発行は 409', async () => {
    const m = await member();
    for (let i = 0; i < 10; i++) expect((await m.api.post('/api/invitations')).status).toBe(201);
    expect((await m.api.post('/api/invitations')).status).toBe(409);
  });

  it('入力の形が違えば 400 の入力エラー', async () => {
    const guest = await loner();
    expect((await guest.api.post('/api/invitations/join', {})).status).toBe(400);
    expect((await adminClient(deps).post('/api/invitations/preview', { token: 5 })).status).toBe(
      400,
    );
  });
});

describe('グループから抜ける・アカウント削除', () => {
  it('最後の 1 人は、もう一度の確認が必要（409 needsLastConfirm）。確認すれば削除される', async () => {
    const m = await member();
    const first = await m.api.post('/api/household/leave', { confirm: true });
    expect(first.status).toBe(409);
    expect(first.body.error.needsLastConfirm).toBe(true);
    const second = await m.api.post('/api/household/leave', { confirm: true, confirmLast: true });
    expect(second.status).toBe(200);
    expect(second.body.householdDeleted).toBe(true);
    // アカウントは残るが、グループはない
    expect((await m.api.get('/api/admin/overview')).status).toBe(403);
  });

  it('確認がなければ 400、何も変わらない', async () => {
    const m = await member();
    expect((await m.api.post('/api/household/leave', {})).status).toBe(400);
    expect((await m.api.get('/api/admin/overview')).status).toBe(200);
  });

  it('アカウント削除：パスワードが違えば 401、正しければ削除されてログイン状態も消える', async () => {
    const m = await member();
    const wrong = await m.api.post('/api/account/delete', {
      confirm: true,
      password: 'wrong-pass',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toBe('パスワードが違います');
    const ok = await m.api.post('/api/account/delete', {
      confirm: true,
      password: 'password-1234',
    });
    expect(ok.status).toBe(200);
    expect(ok.setCookie.join(';')).toMatch(/mp_session=;.*Max-Age=0/);
    expect((await m.api.get('/api/admin/overview')).status).toBe(401);
    await expect(login(deps, { email: m.email, password: 'password-1234' })).rejects.toMatchObject({
      code: 'auth_failed',
    });
  });
});

describe('パスワードの再設定', () => {
  const requestFor = (e: string) =>
    adminClient(deps).post('/api/password-reset/request', { email: e });

  it('登録済みでも未登録でも、同じ応答（ステータスも文言も）', async () => {
    const known = await loner('known');
    const a = await requestFor(known.email);
    const b = await requestFor('nobody-here@example.com');
    expect(a.status).toBe(200);
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
  });

  it('開発用の送信箱から画面に出すリンクで、再設定できる。リンクは 1 回だけ', async () => {
    const u = await loner('forgot');
    await requestFor(u.email);
    const out = await adminClient(deps).get(
      `/api/dev/mail-outbox?email=${encodeURIComponent(u.email)}`,
    );
    expect(out.body.link).toMatch(/^\/password\/reset\?token=/);
    const token = tokenOf(out.body.link);
    const anon = adminClient(deps);
    const done = await anon.post('/api/password-reset/confirm', {
      token,
      password: 'new-password-1',
    });
    expect(done.status).toBe(200);
    await login(deps, { email: u.email, password: 'new-password-1' });
    const reuse = await anon.post('/api/password-reset/confirm', {
      token,
      password: 'new-password-2',
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.message).toContain('このリンクは使えません');
  });

  it('弱いパスワードは 400 で理由を返す', async () => {
    const u = await loner('weak');
    await requestFor(u.email);
    const out = await adminClient(deps).get(
      `/api/dev/mail-outbox?email=${encodeURIComponent(u.email)}`,
    );
    const r = await adminClient(deps).post('/api/password-reset/confirm', {
      token: tokenOf(out.body.link),
      password: 'short',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.password).toContain('8文字以上');
  });

  it('本番の設定では、開発用の送信箱の API は存在しない（404）', async () => {
    const u = await loner('prod');
    await requestFor(u.email);
    deps.config.requireAppOrigin = true;
    try {
      const r = await adminClient(deps).get(
        `/api/dev/mail-outbox?email=${encodeURIComponent(u.email)}`,
      );
      expect(r.status).toBe(404);
    } finally {
      deps.config.requireAppOrigin = false;
    }
  });

  it('未登録のメールアドレスの送信箱は、リンクなし', async () => {
    const r = await adminClient(deps).get('/api/dev/mail-outbox?email=ghost%40example.com');
    expect(r.body).toEqual({ link: null });
  });
});

describe('ログイン失敗の制限と、応答・ログの秘密', () => {
  it('ロック中の表示が出る（認証エラーの一種）', async () => {
    const u = await loner('lock');
    for (let i = 0; i < 5; i++) {
      await login(deps, { email: u.email, password: 'bad-password' }).catch(() => undefined);
    }
    const err = await login(deps, { email: u.email, password: 'password-1234' }).catch((e) => e);
    expect(err.message).toContain('しばらくログインできません');
  });

  it('応答とログに、パスワード・リンクの値が出ない', async () => {
    const owner = await member('secret');
    const issued = await owner.api.post('/api/invitations');
    const token = tokenOf(issued.body.path);
    const u = await loner('leak');
    await adminClient(deps).post('/api/password-reset/request', { email: u.email });
    const resp = await adminClient(deps).post('/api/password-reset/request', { email: u.email });
    expect(resp.text).not.toContain(u.email);
    const leakedAnswers = await u.api.post('/api/account/delete', {
      confirm: true,
      password: 'wrong-secret-pw',
    });
    expect(leakedAnswers.text).not.toContain('wrong-secret-pw');
    const text = logLines.join('\n');
    expect(text).not.toContain(token);
    expect(text).not.toContain('wrong-secret-pw');
  });
});
