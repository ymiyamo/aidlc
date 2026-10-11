import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, login, register } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { createDish } from '@/domain/dish';
import { DomainError } from '@/domain/errors';
import { listHouseholdMembers } from '@/domain/household';
import { createLogger } from '@/lib/logger';
import { insertEvent, listUndeliveredEvents } from '@/repo/admin/events';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import {
  InvitationExpiredError,
  confirmPasswordReset,
  deleteAccount,
  ensureAdminHandlers,
  issueInvitation,
  joinHousehold,
  leaveHousehold,
  previewInvitation,
  readDevOutbox,
  redeliverEvents,
  requestPasswordReset,
  setMailSender,
} from '..';

let deps: AppDeps;
let clock: TestClock;
const logLines: string[] = [];
const delivered: { name: string; payload: unknown }[] = [];

beforeAll(async () => {
  ({ deps, clock } = await createTestDeps({ logger: createLogger((l) => logLines.push(l)) }));
  // 他のユニットの受け口の代わり：届いた出来事を覚える
  for (const name of ['household.member-left', 'household.deleted'] as const) {
    deps.events.subscribe(name, async (payload) => {
      delivered.push({ name, payload });
    });
  }
});
afterAll(async () => {
  await deps.db.close();
});

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
let n = 0;
const email = (label: string) => `${label}${++n}@example.com`;

async function plainAccount(label = 'plain', displayName = label) {
  const e = email(label);
  const s = await register(deps, { email: e, password: 'password-1234', displayName });
  return { email: e, accountId: s.accountId };
}
const expectDomainError = async (p: Promise<unknown>, code: string, message?: string) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (message) expect((err as DomainError).message).toContain(message);
  return err as DomainError;
};
const memberRow = async (memberId: string) =>
  (
    await deps.db.query<{
      left_at: Date | null;
      display_name: string | null;
      account_id: string | null;
    }>('select left_at, display_name, account_id from members where member_id = $1', [memberId])
  ).rows[0];

describe('招待の発行と参加（BR50.9〜BR50.15）', () => {
  it('発行して、別の人が表示名つきで参加できる。元の値は保存されない', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const issued = await issueInvitation(deps, owner.ctx);
    expect(issued.expiresAt.getTime()).toBe(clock.now().getTime() + 7 * DAY);

    const stored = await deps.db.query('select 1 from invitations where token_digest = $1', [
      issued.token,
    ]);
    expect(stored.rows).toHaveLength(0);

    const guest = await plainAccount('guest');
    const joined = await joinHousehold(deps, guest.accountId, {
      token: issued.token,
      displayName: ' はなこ ',
    });
    expect(joined.householdId).toBe(owner.householdId);
    const principal = await authenticate(
      deps,
      (await login(deps, { email: guest.email, password: 'password-1234' })).token,
    );
    expect(principal?.household?.householdId).toBe(owner.householdId);
    expect(principal?.displayName).toBe('はなこ');
  });

  it('表示名が空なら、メールアドレスの @ より前を使う', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const { token } = await issueInvitation(deps, owner.ctx);
    const guest = await plainAccount('nameless');
    const { memberId } = await joinHousehold(deps, guest.accountId, { token, displayName: '' });
    const row = await memberRow(memberId);
    expect(row.display_name).toBe(guest.email.split('@')[0]);
  });

  it('使った招待は使用済みになり、2 回目は「使えません」', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const { token } = await issueInvitation(deps, owner.ctx);
    const a = await plainAccount('a');
    const b = await plainAccount('b');
    await joinHousehold(deps, a.accountId, { token });
    await expectDomainError(joinHousehold(deps, b.accountId, { token }), 'not_found', '使えません');
    expect(await previewInvitation(deps, { token })).toEqual({ status: 'unusable' });
  });

  it('同じリンクを 2 人が同時に使っても、参加できるのは 1 人だけ', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const { token } = await issueInvitation(deps, owner.ctx);
    const a = await plainAccount('race-a');
    const b = await plainAccount('race-b');
    const results = await Promise.allSettled([
      joinHousehold(deps, a.accountId, { token }),
      joinHousehold(deps, b.accountId, { token }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const active = await deps.db.query(
      'select 1 from members where household_id = $1 and left_at is null',
      [owner.householdId],
    );
    expect(active.rows).toHaveLength(2); // 発行した人 + 参加した 1 人
  });

  it('期限（7 日）を過ぎると、表示でも参加でも「期限切れ」になる', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const { token } = await issueInvitation(deps, owner.ctx);
    const guest = await plainAccount('late');
    expect(await previewInvitation(deps, { token })).toMatchObject({ status: 'valid' });
    clock.advanceMs(7 * DAY);
    expect(await previewInvitation(deps, { token })).toEqual({ status: 'expired' });
    const err = await joinHousehold(deps, guest.accountId, { token }).catch((e) => e);
    expect(err).toBeInstanceOf(InvitationExpiredError);
  });

  it('グループ名だけを見せる。見つからないリンクは「使えません」', async () => {
    const owner = await registerWithHousehold(deps, 'preview-name');
    const { token } = await issueInvitation(deps, owner.ctx);
    expect(await previewInvitation(deps, { token })).toEqual({
      status: 'valid',
      householdName: 'preview-name',
    });
    expect(await previewInvitation(deps, { token: 'unknown-token' })).toEqual({
      status: 'unusable',
    });
  });

  it('すでにグループに入っている人は参加できず、リンクは使用済みにならない', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const other = await registerWithHousehold(deps, 'other');
    const { token } = await issueInvitation(deps, owner.ctx);
    await expectDomainError(
      joinHousehold(deps, other.session.accountId, { token }),
      'conflict',
      '先に今のグループから抜けてください',
    );
    expect(await previewInvitation(deps, { token })).toMatchObject({ status: 'valid' });
  });

  it('有効な招待は 1 グループ 10 本まで。他のグループには影響しない', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const other = await registerWithHousehold(deps, 'other');
    for (let i = 0; i < 10; i++) await issueInvitation(deps, owner.ctx);
    await expectDomainError(issueInvitation(deps, owner.ctx), 'conflict', 'いっぱい');
    await issueInvitation(deps, other.ctx);
    // 期限が切れた分は数えない
    clock.advanceMs(7 * DAY);
    await issueInvitation(deps, owner.ctx);
  });

  it('他のグループの招待で、自分のグループには入れない（参加先はリンクだけで決まる）', async () => {
    const a = await registerWithHousehold(deps, 'grp-a');
    const b = await registerWithHousehold(deps, 'grp-b');
    const { token } = await issueInvitation(deps, a.ctx);
    const guest = await plainAccount('guest');
    // 画面から householdId を送りつけても使われない
    const { householdId } = await joinHousehold(deps, guest.accountId, {
      token,
      householdId: b.householdId,
    });
    expect(householdId).toBe(a.householdId);
  });

  it('グループが削除されたあとは、そのグループの招待で参加できず、Member も作られない', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const { token } = await issueInvitation(deps, owner.ctx);
    await leaveHousehold(deps, owner.session.accountId, { confirm: true, confirmLast: true });
    const guest = await plainAccount('too-late');
    await expectDomainError(
      joinHousehold(deps, guest.accountId, { token }),
      'not_found',
      '使えません',
    );
    const members = await deps.db.query(
      'select 1 from members where household_id = $1 and left_at is null',
      [owner.householdId],
    );
    expect(members.rows).toHaveLength(0);
  });

  it('参加とグループ削除が同時でも、存在しないグループの Member はできない', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const { token } = await issueInvitation(deps, owner.ctx);
    const guest = await plainAccount('concurrent');
    const [leave, join] = await Promise.allSettled([
      leaveHousehold(deps, owner.session.accountId, { confirm: true, confirmLast: true }),
      joinHousehold(deps, guest.accountId, { token }),
    ]);
    expect(leave.status).toBe('fulfilled');
    const live = await deps.db.query(
      `select 1 from members m join households h using (household_id)
       where m.household_id = $1 and m.left_at is null and h.deleted_at is not null`,
      [owner.householdId],
    );
    expect(live.rows).toHaveLength(0);
    if (join.status === 'rejected') {
      expect((join.reason as DomainError).code).toBe('not_found');
    }
  });

  it('抜けた人が招待で戻ると、新しいメンバーになる。前の行は退会のまま（BR50.15）', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const rejoiner = await plainAccount('rejoin');
    const first = await joinHousehold(deps, rejoiner.accountId, {
      token: (await issueInvitation(deps, owner.ctx)).token,
    });
    await leaveHousehold(deps, rejoiner.accountId, { confirm: true });
    const second = await joinHousehold(deps, rejoiner.accountId, {
      token: (await issueInvitation(deps, owner.ctx)).token,
    });
    expect(second.memberId).not.toBe(first.memberId);
    expect((await memberRow(first.memberId)).left_at).not.toBeNull();
    expect((await memberRow(second.memberId)).left_at).toBeNull();
  });
});

describe('グループから抜ける・グループ削除（BR50.16〜BR50.22）', () => {
  it('抜けると退会になり、名前とアカウントのつながりが消え、出来事が記録され配られる', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const guest = await plainAccount('leaver');
    const { memberId } = await joinHousehold(deps, guest.accountId, {
      token: (await issueInvitation(deps, owner.ctx)).token,
    });
    delivered.length = 0;
    const r = await leaveHousehold(deps, guest.accountId, { confirm: true });
    expect(r).toEqual({ left: true, householdDeleted: false });
    const row = await memberRow(memberId);
    expect(row.left_at).not.toBeNull();
    expect(row.display_name).toBeNull();
    expect(row.account_id).toBeNull();
    expect(delivered).toEqual([
      {
        name: 'household.member-left',
        payload: expect.objectContaining({ householdId: owner.householdId, memberId }),
      },
    ]);
    expect(
      (await listUndeliveredEvents(deps.db)).filter((e) => e.payload.memberId === memberId),
    ).toEqual([]);
    // グループは残り、残った人はそのまま使える
    expect((await authenticateAs(owner.email))?.household?.householdId).toBe(owner.householdId);
  });

  it('保存した料理は残り、保存した人は「退会したメンバー」と表示される', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const guest = await plainAccount('saver');
    const { memberId } = await joinHousehold(deps, guest.accountId, {
      token: (await issueInvitation(deps, owner.ctx)).token,
    });
    const dish = await createDish(
      deps,
      { householdId: owner.householdId, memberId },
      { name: '残る料理', url: 'https://example.com/keep' },
      { confirmDuplicate: false },
    );
    await leaveHousehold(deps, guest.accountId, { confirm: true });
    const dishes = await deps.db.query('select dish_id from dishes where dish_id = $1', [
      dish.dishId,
    ]);
    expect(dishes.rows).toHaveLength(1);
    const labels = (await listHouseholdMembers(deps, owner.householdId)).map((m) => m.displayName);
    expect(labels).toContain('退会したメンバー');
  });

  it('確認がなければ何も変えない。すでに抜けていれば何も起きず成功する（冪等）', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const guest = await plainAccount('idem');
    await joinHousehold(deps, guest.accountId, {
      token: (await issueInvitation(deps, owner.ctx)).token,
    });
    await expectDomainError(leaveHousehold(deps, guest.accountId, {}), 'validation');
    expect(await leaveHousehold(deps, guest.accountId, { confirm: true })).toMatchObject({
      left: true,
    });
    expect(await leaveHousehold(deps, guest.accountId, { confirm: true })).toEqual({
      left: false,
      householdDeleted: false,
    });
  });

  it('最後の 1 人は、もう一度の確認がなければ抜けられない。確認すればグループが削除される', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    await issueInvitation(deps, owner.ctx);
    const err = await expectDomainError(
      leaveHousehold(deps, owner.session.accountId, { confirm: true }),
      'conflict',
      '最後のメンバー',
    );
    expect(err.data).toEqual({ needsLastConfirm: true });
    expect((await memberRow(owner.memberId)).left_at).toBeNull();

    delivered.length = 0;
    const r = await leaveHousehold(deps, owner.session.accountId, {
      confirm: true,
      confirmLast: true,
    });
    expect(r).toEqual({ left: true, householdDeleted: true });
    expect(delivered.map((d) => d.name).sort()).toEqual([
      'household.deleted',
      'household.member-left',
    ]);
    const inv = await deps.db.query('select 1 from invitations where household_id = $1', [
      owner.householdId,
    ]);
    expect(inv.rows).toHaveLength(0);
    // アカウントは残り、再びグループを作れる
    expect(await authenticateAs(owner.email)).not.toBeNull();
  });

  it('2 人が同時に抜けると、あとに確定した人がグループを削除する（出来事は 1 回ずつ）', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const guest = await plainAccount('both');
    await joinHousehold(deps, guest.accountId, {
      token: (await issueInvitation(deps, owner.ctx)).token,
    });
    delivered.length = 0;
    const results = await Promise.all([
      leaveHousehold(deps, owner.session.accountId, { confirm: true, confirmLast: true }),
      leaveHousehold(deps, guest.accountId, { confirm: true, confirmLast: true }),
    ]);
    expect(results.every((r) => r.left)).toBe(true);
    expect(results.filter((r) => r.householdDeleted)).toHaveLength(1);
    expect(delivered.filter((d) => d.name === 'household.deleted')).toHaveLength(1);
    expect(delivered.filter((d) => d.name === 'household.member-left')).toHaveLength(2);
  });
});

async function authenticateAs(emailAddress: string) {
  const s = await login(deps, { email: emailAddress, password: 'password-1234' });
  return authenticate(deps, s.token);
}

describe('ログイン失敗の制限（BR50.5〜BR50.8）', () => {
  const bad = (e: string) => login(deps, { email: e, password: 'wrong-password' });
  const good = (e: string) => login(deps, { email: e, password: 'password-1234' });

  it('5 回続けて失敗すると 15 分ロックされ、正しいパスワードでも入れない。15 分後に解除される', async () => {
    const a = await plainAccount('lock');
    for (let i = 0; i < 4; i++) await expectDomainError(bad(a.email), 'auth_failed', '違います');
    await expectDomainError(bad(a.email), 'auth_failed', '違います'); // 5 回目までは同じ文言
    const locked = await expectDomainError(good(a.email), 'auth_failed', '約 15 分');
    expect(locked.data).toEqual({ locked: true });
    // ロック中に試しても期限は延びない
    clock.advanceMs(14 * MIN);
    await expectDomainError(good(a.email), 'auth_failed', '約 15 分');
    clock.advanceMs(1 * MIN);
    await good(a.email);
  });

  it('間に成功が入ると数え直す。未登録のメールアドレスの失敗は数えない', async () => {
    const a = await plainAccount('reset-count');
    for (let i = 0; i < 4; i++) await expectDomainError(bad(a.email), 'auth_failed');
    await good(a.email);
    for (let i = 0; i < 4; i++) await expectDomainError(bad(a.email), 'auth_failed');
    await good(a.email); // まだロックされていない
    for (let i = 0; i < 10; i++) {
      const err = await expectDomainError(bad('nobody@example.com'), 'auth_failed');
      expect(err.message).toBe('メールアドレスまたはパスワードが違います');
    }
  });
});

describe('パスワードの再設定（BR50.1〜BR50.4）', () => {
  const linkOf = async (e: string) => {
    const mail = await readDevOutbox(deps, e);
    const m = mail?.body.match(/token=([^\s]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  it('登録済みでも未登録でも、同じように終わる。送信箱には登録済みの分だけ残る', async () => {
    const a = await plainAccount('forgot');
    await requestPasswordReset(deps, { email: a.email });
    await requestPasswordReset(deps, { email: 'ghost@example.com' });
    expect(await linkOf(a.email)).not.toBeNull();
    expect(await readDevOutbox(deps, 'ghost@example.com')).toBeNull();
    await expectDomainError(requestPasswordReset(deps, { email: 'not-an-email' }), 'validation');
  });

  it('リンクで新しいパスワードを設定でき、ログイン状態は終わり、ロックも解け、1 回しか使えない', async () => {
    const a = await plainAccount('confirm');
    const session = await login(deps, { email: a.email, password: 'password-1234' });
    for (let i = 0; i < 5; i++) {
      await login(deps, { email: a.email, password: 'x-wrong-pass' }).catch(() => undefined);
    }
    await requestPasswordReset(deps, { email: a.email }); // ロック中でも要求できる
    const token = (await linkOf(a.email))!;
    await confirmPasswordReset(deps, { token, password: 'brand-new-pass' });
    expect(await authenticate(deps, session.token)).toBeNull();
    await login(deps, { email: a.email, password: 'brand-new-pass' });
    await expectDomainError(
      confirmPasswordReset(deps, { token, password: 'another-pass-1' }),
      'validation',
      'このリンクは使えません',
    );
  });

  it('弱いパスワードは失敗するが、リンクは使用済みにならない', async () => {
    const a = await plainAccount('weak');
    await requestPasswordReset(deps, { email: a.email });
    const token = (await linkOf(a.email))!;
    const err = await expectDomainError(
      confirmPasswordReset(deps, { token, password: 'short' }),
      'validation',
    );
    expect(err.fields?.password).toContain('8文字以上');
    await confirmPasswordReset(deps, { token, password: 'long-enough-pw' });
  });

  it('新しく発行すると前のリンクは使えない。60 分を過ぎても使えない。壊れたリンクも同じ表示', async () => {
    const a = await plainAccount('old');
    await requestPasswordReset(deps, { email: a.email });
    const first = (await linkOf(a.email))!;
    clock.advanceMs(1);
    await requestPasswordReset(deps, { email: a.email });
    const second = (await linkOf(a.email))!;
    expect(second).not.toBe(first);
    await expectDomainError(
      confirmPasswordReset(deps, { token: first, password: 'long-enough-pw' }),
      'validation',
      'このリンクは使えません',
    );
    clock.advanceMs(60 * MIN);
    await expectDomainError(
      confirmPasswordReset(deps, { token: second, password: 'long-enough-pw' }),
      'validation',
      'このリンクは使えません',
    );
    await expectDomainError(
      confirmPasswordReset(deps, { token: 'garbage', password: 'long-enough-pw' }),
      'validation',
      'このリンクは使えません',
    );
  });

  it('同じリンクで同時に 2 回確定しても、成功は 1 回だけ', async () => {
    const a = await plainAccount('twice');
    await requestPasswordReset(deps, { email: a.email });
    const token = (await linkOf(a.email))!;
    const r = await Promise.allSettled([
      confirmPasswordReset(deps, { token, password: 'long-enough-pw' }),
      confirmPasswordReset(deps, { token, password: 'long-enough-pw2' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('発行は 1 時間に 3 回まで。応答は変わらず、1 時間後にはまた発行できる', async () => {
    const a = await plainAccount('limit');
    for (let i = 0; i < 5; i++) {
      await requestPasswordReset(deps, { email: a.email });
      clock.advanceMs(1000);
    }
    const count = async () =>
      Number(
        (
          await deps.db.query<{ n: string }>(
            'select count(*) n from password_resets r join accounts a using (account_id) where lower(a.email) = lower($1)',
            [a.email],
          )
        ).rows[0].n,
      );
    expect(await count()).toBe(3);
    clock.advanceMs(60 * MIN);
    await requestPasswordReset(deps, { email: a.email });
    expect(await count()).toBe(4);
  });

  it('メールの窓口が失敗しても、要求は正常に終わる。窓口を差し替えられる', async () => {
    const a = await plainAccount('mailfail');
    const sent: string[] = [];
    setMailSender(deps, {
      send: async (m) => {
        sent.push(m.to);
        throw new Error('smtp down');
      },
    });
    await requestPasswordReset(deps, { email: a.email });
    expect(sent).toEqual([a.email]);
    setMailSender(deps, null);
  });

  it('本番の設定（送信箱が無効）では、送信箱は読めない', async () => {
    const a = await plainAccount('prod');
    await requestPasswordReset(deps, { email: a.email });
    expect(await readDevOutbox(deps, a.email)).not.toBeNull();
    deps.config.requireAppOrigin = true;
    try {
      expect(await readDevOutbox(deps, a.email)).toBeNull();
    } finally {
      deps.config.requireAppOrigin = false;
    }
  });
});

describe('アカウント削除（BR50.19〜BR50.21）', () => {
  it('パスワードが違えば何も変えない。連続 5 回まちがえると 15 分受け付けない', async () => {
    const a = await registerWithHousehold(deps, 'del-wrong');
    for (let i = 0; i < 5; i++) {
      await expectDomainError(
        deleteAccount(deps, a.session.accountId, { confirm: true, password: 'nope-nope' }),
        'auth_failed',
        'パスワードが違います',
      );
    }
    // 6 回目は、正しくても受け付けない
    const locked = await expectDomainError(
      deleteAccount(deps, a.session.accountId, { confirm: true, password: 'password-1234' }),
      'auth_failed',
      '約 15 分',
    );
    expect(locked.data).toEqual({ locked: true });
    expect(await authenticateAs(a.email)).not.toBeNull(); // ログインの制限には数えない
    clock.advanceMs(15 * MIN);
    await deleteAccount(deps, a.session.accountId, { confirm: true, password: 'password-1234' });
  });

  it('確認（confirm）がなければ実行しない', async () => {
    const a = await registerWithHousehold(deps, 'del-noconfirm');
    await expectDomainError(
      deleteAccount(deps, a.session.accountId, { password: 'password-1234' }),
      'validation',
    );
    expect(await authenticateAs(a.email)).not.toBeNull();
  });

  it('削除すると、ログインできず、同じメールアドレスで登録し直せる。メンバーは退会になる', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const guest = await plainAccount('goner');
    const { memberId } = await joinHousehold(deps, guest.accountId, {
      token: (await issueInvitation(deps, owner.ctx)).token,
    });
    const session = await login(deps, { email: guest.email, password: 'password-1234' });
    delivered.length = 0;
    await deleteAccount(deps, guest.accountId, { confirm: true, password: 'password-1234' });

    const row = (
      await deps.db.query<Record<string, unknown>>(
        'select email, password_digest, display_name, deleted_at from accounts where account_id = $1',
        [guest.accountId],
      )
    ).rows[0];
    expect(row.email).toBeNull();
    expect(row.password_digest).toBeNull();
    expect(row.display_name).toBeNull();
    expect(row.deleted_at).not.toBeNull();
    expect(await authenticate(deps, session.token)).toBeNull();
    await expectDomainError(
      login(deps, { email: guest.email, password: 'password-1234' }),
      'auth_failed',
    );
    expect((await memberRow(memberId)).left_at).not.toBeNull();
    expect(delivered.map((d) => d.name)).toEqual(['household.member-left']);
    // 同じメールアドレスで新しく登録できる
    await register(deps, { email: guest.email, password: 'password-1234' });
  });

  it('最後の 1 人のアカウントを削除すると、グループも削除される。2 回目は何も起きない', async () => {
    const owner = await registerWithHousehold(deps, 'solo');
    delivered.length = 0;
    await deleteAccount(deps, owner.session.accountId, {
      confirm: true,
      password: 'password-1234',
    });
    expect(delivered.map((d) => d.name).sort()).toEqual([
      'household.deleted',
      'household.member-left',
    ]);
    const hh = await deps.db.query('select deleted_at from households where household_id = $1', [
      owner.householdId,
    ]);
    expect(hh.rows[0]).toMatchObject({ deleted_at: expect.any(Date) });
    delivered.length = 0;
    await deleteAccount(deps, owner.session.accountId, {
      confirm: true,
      password: 'password-1234',
    });
    expect(delivered).toEqual([]);
  });

  it('削除後も保存した料理は残り、保存した人は「退会したメンバー」と表示される', async () => {
    const owner = await registerWithHousehold(deps, 'own');
    const guest = await plainAccount('dish-owner');
    const { memberId } = await joinHousehold(deps, guest.accountId, {
      token: (await issueInvitation(deps, owner.ctx)).token,
    });
    const dish = await createDish(
      deps,
      { householdId: owner.householdId, memberId },
      { name: '残る', url: 'https://example.com/stay' },
      { confirmDuplicate: false },
    );
    await deleteAccount(deps, guest.accountId, { confirm: true, password: 'password-1234' });
    expect(
      (await deps.db.query('select 1 from dishes where dish_id = $1', [dish.dishId])).rows,
    ).toHaveLength(1);
    expect(
      (await listHouseholdMembers(deps, owner.householdId)).map((m) => m.displayName),
    ).toContain('退会したメンバー');
  });
});

describe('出来事の配り直し（BR50.23、BR50.24）', () => {
  it('配れなかった account.deleted を配り直すと退会になる。何度配っても結果は同じ', async () => {
    const owner = await registerWithHousehold(deps, 'redeliver');
    const eventId = crypto.randomUUID();
    // 記録だけが確定して、配達が済んでいない状態（配達の途中でアプリが止まった場合）
    await insertEvent(deps.db, {
      eventId,
      name: 'account.deleted',
      payload: { eventId, accountId: owner.session.accountId },
      occurredAt: clock.now(),
    });
    expect(await redeliverEvents(deps)).toBeGreaterThanOrEqual(1);
    expect((await memberRow(owner.memberId)).left_at).not.toBeNull();
    // 同じ出来事をもう一度届けても、エラーにならず、何も増えない
    delivered.length = 0;
    ensureAdminHandlers(deps);
    await deps.events.publish('account.deleted', { eventId, accountId: owner.session.accountId });
    expect(delivered).toEqual([]);
    expect((await listUndeliveredEvents(deps.db)).filter((e) => e.eventId === eventId)).toEqual([]);
  });
});

describe('ログに出さないもの（BR50.26）', () => {
  it('パスワード・リンクの値・メールアドレスは、ログに出ない', async () => {
    const a = await plainAccount('secret-holder');
    await requestPasswordReset(deps, { email: a.email });
    const mail = (await readDevOutbox(deps, a.email))!;
    const token = decodeURIComponent(mail.body.match(/token=([^\s]+)/)![1]);
    await confirmPasswordReset(deps, { token, password: 'my-secret-password' });
    const owner = await registerWithHousehold(deps, 'logger');
    const invite = await issueInvitation(deps, owner.ctx);
    const text = logLines.join('\n');
    for (const secret of [token, invite.token, 'my-secret-password', 'password-1234', a.email]) {
      expect(text).not.toContain(secret);
    }
  });
});
