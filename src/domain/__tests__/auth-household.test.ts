import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, hashSessionToken, login, logout, register, SESSION_DAYS } from '../auth';
import { createHousehold, listHouseholdMembers, memberLabel } from '../household';
import { createTestDeps, type TestClock } from '@/test-helpers/deps';
import type { AppDeps } from '../deps';

let deps: AppDeps;
let clock: TestClock;
beforeAll(async () => {
  ({ deps, clock } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

const reg = (over: Record<string, unknown> = {}) =>
  register(deps, { email: `u${randomUUID()}@example.com`, password: 'password-1234', ...over });

describe('登録（BR1.1〜BR1.4）', () => {
  it('8 文字未満のパスワードは登録できない', async () => {
    await expect(reg({ password: '1234567' })).rejects.toMatchObject({
      code: 'validation',
      fields: { password: expect.stringContaining('8文字以上') },
    });
  });

  it('メールアドレスの形式が正しくなければ登録できない', async () => {
    await expect(reg({ email: 'not-an-email' })).rejects.toMatchObject({ code: 'validation' });
  });

  it('同じメールアドレス（大文字小文字違い）は競合。同時に登録しても 1 件', async () => {
    const email = `Dup${randomUUID()}@Example.com`;
    const results = await Promise.allSettled([
      register(deps, { email, password: 'password-1234' }),
      register(deps, { email: email.toLowerCase(), password: 'password-1234' }),
      register(deps, { email: email.toUpperCase(), password: 'password-1234' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
    }
  });

  it('パスワードは元の文字列のまま保存されない', async () => {
    const s = await reg({ password: 'secret-pass-xyz' });
    const row = await deps.db.query<{ password_digest: string }>(
      'select password_digest from accounts where account_id = $1',
      [s.accountId],
    );
    expect(row.rows[0].password_digest).not.toContain('secret-pass-xyz');
    expect(row.rows[0].password_digest).toMatch(/^\$2[aby]\$/);
  });

  it('登録するとそのままログイン状態になる。DB には Cookie の値のハッシュだけが入る', async () => {
    const s = await reg();
    const principal = await authenticate(deps, s.token);
    expect(principal?.accountId).toBe(s.accountId);
    const stored = await deps.db.query<{ session_id: string }>(
      'select session_id from login_sessions where account_id = $1',
      [s.accountId],
    );
    expect(stored.rows[0].session_id).toBe(hashSessionToken(s.token));
    expect(stored.rows[0].session_id).not.toBe(s.token);
  });
});

describe('ログインとログアウト（BR1.5、BR1.6）', () => {
  it('正しい組でログインでき、間違いは理由を区別しない', async () => {
    const email = `l${randomUUID()}@example.com`;
    await register(deps, { email, password: 'password-1234' });
    const ok = await login(deps, { email: email.toUpperCase(), password: 'password-1234' });
    expect(ok.token).toBeTruthy();
    const wrongPass = login(deps, { email, password: 'wrong-password' });
    const noUser = login(deps, { email: 'nobody@example.com', password: 'password-1234' });
    await expect(wrongPass).rejects.toMatchObject({
      code: 'auth_failed',
      message: 'メールアドレスまたはパスワードが違います',
    });
    await expect(noUser).rejects.toMatchObject({
      code: 'auth_failed',
      message: 'メールアドレスまたはパスワードが違います',
    });
  });

  it('ログイン状態は 30 日で切れ、ログアウトするとすぐ無効になる', async () => {
    const a = await reg();
    expect(await authenticate(deps, a.token)).not.toBeNull();
    const b = await reg();
    await logout(deps, b.token);
    expect(await authenticate(deps, b.token)).toBeNull();
    clock.advanceMs(SESSION_DAYS * 24 * 60 * 60 * 1000 + 1000);
    expect(await authenticate(deps, a.token)).toBeNull();
  });

  it('値がなければ、または知らない値なら未ログイン', async () => {
    expect(await authenticate(deps, null)).toBeNull();
    expect(await authenticate(deps, 'unknown-token')).toBeNull();
  });
});

describe('グループ作成（BR2.1、BR2.2、BR2.6）', () => {
  it('Household と最初の Member を作り、初期データ 30 件が入る', async () => {
    const s = await reg({ displayName: 'ママ' });
    const { householdId, memberId } = await createHousehold(deps, s.accountId, { name: '山田家' });
    const principal = await authenticate(deps, s.token);
    expect(principal?.household).toEqual({ householdId, memberId });
    expect(principal?.displayName).toBe('ママ');
    const n = await deps.db.query<{ n: string }>(
      "select count(*) as n from dishes where household_id = $1 and source = 'seed'",
      [householdId],
    );
    expect(Number(n.rows[0].n)).toBe(30);
  });

  it('グループ名が空なら「わが家」。50 文字を超えると作らない', async () => {
    const s = await reg();
    await expect(
      createHousehold(deps, s.accountId, { name: 'あ'.repeat(51) }),
    ).rejects.toMatchObject({
      code: 'validation',
    });
    const { householdId } = await createHousehold(deps, s.accountId, { name: '  ' });
    const h = await deps.db.query<{ name: string }>(
      'select name from households where household_id = $1',
      [householdId],
    );
    expect(h.rows[0].name).toBe('わが家');
  });

  it('同じ人が同時に 2 つのグループを作っても 1 つだけ。失敗側の Household は残らない', async () => {
    const s = await reg();
    const before = await deps.db.query<{ n: string }>('select count(*) as n from households');
    const results = await Promise.allSettled([
      createHousehold(deps, s.accountId, { name: 'A' }),
      createHousehold(deps, s.accountId, { name: 'B' }),
      createHousehold(deps, s.accountId, { name: 'C' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
    }
    const after = await deps.db.query<{ n: string }>('select count(*) as n from households');
    expect(Number(after.rows[0].n) - Number(before.rows[0].n)).toBe(1);
  });

  it('メンバー一覧。退会した（または名前のない）メンバーは「退会したメンバー」（BR2.5）', async () => {
    const s = await reg({ displayName: 'パパ' });
    const { householdId } = await createHousehold(deps, s.accountId, {});
    expect(await listHouseholdMembers(deps, householdId)).toEqual([
      { memberId: expect.any(String), displayName: 'パパ' },
    ]);
    expect(memberLabel({ displayName: 'x', leftAt: new Date() })).toBe('退会したメンバー');
    expect(memberLabel({ displayName: null, leftAt: null })).toBe('退会したメンバー');
  });
});
