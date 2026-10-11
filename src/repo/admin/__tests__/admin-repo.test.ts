import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearExpiredLoginLock,
  clearLoginFailures,
  getLoginLockedUntil,
  recordLoginFailure,
  findAccountByEmail,
  findAccountById,
} from '@/repo/accounts';
import {
  countActiveInvitations,
  deleteInvitationsOfHousehold,
  findInvitationByDigest,
  insertInvitation,
  markInvitationUsed,
} from '@/repo/admin/invitations';
import {
  countActiveMembers,
  findActiveMembership,
  findLiveHouseholdName,
  lockLiveHousehold,
  markAccountDeleted,
  markHouseholdDeleted,
  markMemberLeft,
} from '@/repo/admin/membership';
import {
  consumeReset,
  findLatestOutboxMail,
  findResetByDigest,
  insertOutboxMail,
  insertReset,
  invalidateActiveResets,
  countResetsSince,
} from '@/repo/admin/resets';
import { insertEvent, listUndeliveredEvents, markEventDelivered } from '@/repo/admin/events';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import type { AppDeps } from '@/domain/deps';

let deps: AppDeps;
let clock: TestClock;
beforeAll(async () => {
  ({ deps, clock } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

const id = () => crypto.randomUUID();
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

async function invitation(
  h: { householdId: string; memberId: string },
  digest: string,
  ttl = 7 * DAY,
) {
  const invitationId = id();
  await insertInvitation(deps.db, {
    invitationId,
    householdId: h.householdId,
    tokenDigest: digest,
    issuedBy: h.memberId,
    issuedAt: clock.now(),
    expiresAt: plus(clock.now(), ttl),
  });
  return invitationId;
}

describe('招待のデータアクセス', () => {
  it('変換値で探せて、グループは招待の側から決まる（BR50.14）', async () => {
    const a = await registerWithHousehold(deps, 'inv-a');
    await invitation(a, 'digest-find');
    const found = await findInvitationByDigest(deps.db, 'digest-find');
    expect(found?.householdId).toBe(a.householdId);
    expect(await findInvitationByDigest(deps.db, 'unknown')).toBeNull();
  });

  it('有効な本数は、グループごとに数える。使用済みと期限切れは数えない', async () => {
    const a = await registerWithHousehold(deps, 'cnt-a');
    const b = await registerWithHousehold(deps, 'cnt-b');
    await invitation(a, 'cnt-1');
    await invitation(a, 'cnt-2');
    const used = await invitation(a, 'cnt-3');
    await invitation(a, 'cnt-4', 1000);
    await invitation(b, 'cnt-5');
    await markInvitationUsed(deps.db, used, b.session.accountId, clock.now());
    clock.advanceMs(2000);
    expect(await countActiveInvitations(deps.db, a.householdId, clock.now())).toBe(2);
    expect(await countActiveInvitations(deps.db, b.householdId, clock.now())).toBe(1);
  });

  it('使用済みにできるのは 1 回だけ。期限が過ぎたものは使用済みにできない', async () => {
    const a = await registerWithHousehold(deps, 'use-a');
    const inv = await invitation(a, 'use-1');
    const results = await Promise.all([
      markInvitationUsed(deps.db, inv, id(), clock.now()),
      markInvitationUsed(deps.db, inv, id(), clock.now()),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const expired = await invitation(a, 'use-2', 1000);
    clock.advanceMs(1000);
    expect(await markInvitationUsed(deps.db, expired, id(), clock.now())).toBe(false);
  });

  it('グループ削除では、そのグループの招待だけが消える', async () => {
    const a = await registerWithHousehold(deps, 'del-a');
    const b = await registerWithHousehold(deps, 'del-b');
    await invitation(a, 'del-1');
    await invitation(b, 'del-2');
    expect(await deleteInvitationsOfHousehold(deps.db, a.householdId)).toBe(1);
    expect(await findInvitationByDigest(deps.db, 'del-1')).toBeNull();
    expect(await findInvitationByDigest(deps.db, 'del-2')).not.toBeNull();
  });
});

describe('再設定・送信箱のデータアクセス', () => {
  it('有効なリンクだけが見つかる。無効にしたもの・使用済み・期限切れは見つからない', async () => {
    const a = await registerWithHousehold(deps, 'rs-a');
    const accountId = a.session.accountId;
    const insert = (digest: string, ttl: number) =>
      insertReset(deps.db, {
        resetId: id(),
        accountId,
        tokenDigest: digest,
        issuedAt: clock.now(),
        expiresAt: plus(clock.now(), ttl),
      });
    await insert('rs-1', 60 * 60 * 1000);
    expect(await findResetByDigest(deps.db, 'rs-1', clock.now())).not.toBeNull();
    await invalidateActiveResets(deps.db, accountId, clock.now());
    expect(await findResetByDigest(deps.db, 'rs-1', clock.now())).toBeNull();
    await insert('rs-2', 1000);
    clock.advanceMs(1000);
    expect(await findResetByDigest(deps.db, 'rs-2', clock.now())).toBeNull();
  });

  it('確定（使用済みにする）は同時に 2 回来ても 1 回だけ成功する', async () => {
    const a = await registerWithHousehold(deps, 'rs-b');
    await insertReset(deps.db, {
      resetId: id(),
      accountId: a.session.accountId,
      tokenDigest: 'rs-once',
      issuedAt: clock.now(),
      expiresAt: plus(clock.now(), 1000 * 60),
    });
    const r = await Promise.all([
      consumeReset(deps.db, 'rs-once', clock.now()),
      consumeReset(deps.db, 'rs-once', clock.now()),
    ]);
    expect(r.filter((x) => x !== null)).toEqual([a.session.accountId]);
  });

  it('発行の本数は、指定した時刻より後のものだけ数える', async () => {
    const a = await registerWithHousehold(deps, 'rs-c');
    const accountId = a.session.accountId;
    const before = clock.now();
    clock.advanceMs(1000);
    await insertReset(deps.db, {
      resetId: id(),
      accountId,
      tokenDigest: 'rs-count',
      issuedAt: clock.now(),
      expiresAt: plus(clock.now(), 5000),
    });
    expect(await countResetsSince(deps.db, accountId, before)).toBe(1);
    expect(await countResetsSince(deps.db, accountId, clock.now())).toBe(0);
  });

  it('送信箱：宛先の最新の 1 通が、大文字小文字を区別せず見つかる。期限が過ぎると見えない', async () => {
    const a = await registerWithHousehold(deps, 'ob-a');
    const put = (body: string) =>
      insertOutboxMail(deps.db, {
        outboxId: id(),
        accountId: a.session.accountId,
        to: 'Outbox@Example.com',
        subject: '件名',
        body,
        createdAt: clock.now(),
        expiresAt: plus(clock.now(), 1000),
      });
    await put('古い');
    clock.advanceMs(1);
    await put('新しい');
    expect((await findLatestOutboxMail(deps.db, 'outbox@example.com', clock.now()))?.body).toBe(
      '新しい',
    );
    clock.advanceMs(1000);
    expect(await findLatestOutboxMail(deps.db, 'outbox@example.com', clock.now())).toBeNull();
  });
});

describe('ログイン失敗の制限のデータアクセス（BR50.5〜BR50.7）', () => {
  it('5 回目の失敗でロックされ、期限が過ぎると数え直される', async () => {
    const a = await registerWithHousehold(deps, 'lk-a');
    const accountId = a.session.accountId;
    for (let i = 0; i < 4; i++) await recordLoginFailure(deps.db, accountId, clock.now());
    expect(await getLoginLockedUntil(deps.db, accountId, clock.now())).toBeNull();
    await recordLoginFailure(deps.db, accountId, clock.now());
    const until = await getLoginLockedUntil(deps.db, accountId, clock.now());
    expect(until?.getTime()).toBe(clock.now().getTime() + 15 * 60 * 1000);
    clock.advanceMs(15 * 60 * 1000);
    expect(await getLoginLockedUntil(deps.db, accountId, clock.now())).toBeNull();
    await clearExpiredLoginLock(deps.db, accountId, clock.now());
    await recordLoginFailure(deps.db, accountId, clock.now());
    expect(await getLoginLockedUntil(deps.db, accountId, clock.now())).toBeNull();
  });

  it('同時の失敗を数え落とさない。成功で数え直す', async () => {
    const a = await registerWithHousehold(deps, 'lk-b');
    const accountId = a.session.accountId;
    await Promise.all(
      Array.from({ length: 5 }, () => recordLoginFailure(deps.db, accountId, clock.now())),
    );
    expect(await getLoginLockedUntil(deps.db, accountId, clock.now())).not.toBeNull();
    await clearLoginFailures(deps.db, accountId);
    expect(await getLoginLockedUntil(deps.db, accountId, clock.now())).toBeNull();
  });
});

describe('メンバーシップ・削除済みの除外', () => {
  it('削除済みのアカウントは、メールアドレスでも ID でも見つからない（BR50.8）', async () => {
    const a = await registerWithHousehold(deps, 'gone-a');
    expect(await findAccountByEmail(deps.db, a.email)).not.toBeNull();
    expect(await markAccountDeleted(deps.db, a.session.accountId, clock.now())).toBe(true);
    expect(await findAccountByEmail(deps.db, a.email)).toBeNull();
    expect(await findAccountById(deps.db, a.session.accountId)).toBeNull();
    // 2 回目は何も起きない（冪等）
    expect(await markAccountDeleted(deps.db, a.session.accountId, clock.now())).toBe(false);
  });

  it('退会は名前とアカウントを消し、2 回目は何も起きない。有効な人数に数えない', async () => {
    const a = await registerWithHousehold(deps, 'mem-a');
    expect(await countActiveMembers(deps.db, a.householdId)).toBe(1);
    expect(await findActiveMembership(deps.db, a.session.accountId)).toEqual({
      memberId: a.memberId,
      householdId: a.householdId,
    });
    expect(await markMemberLeft(deps.db, a.memberId, clock.now())).toBe(true);
    expect(await markMemberLeft(deps.db, a.memberId, clock.now())).toBe(false);
    expect(await countActiveMembers(deps.db, a.householdId)).toBe(0);
    expect(await findActiveMembership(deps.db, a.session.accountId)).toBeNull();
    const row = await deps.db.query<{ display_name: string | null; account_id: string | null }>(
      'select display_name, account_id from members where member_id = $1',
      [a.memberId],
    );
    expect(row.rows[0]).toEqual({ display_name: null, account_id: null });
  });

  it('削除済みのグループは、ロックも名前の取得もできない（冪等）', async () => {
    const a = await registerWithHousehold(deps, 'hh-a');
    expect(await findLiveHouseholdName(deps.db, a.householdId)).toBe('hh-a');
    expect(await deps.db.transaction((tx) => lockLiveHousehold(tx, a.householdId))).toBe(true);
    expect(await markHouseholdDeleted(deps.db, a.householdId, clock.now())).toBe(true);
    expect(await markHouseholdDeleted(deps.db, a.householdId, clock.now())).toBe(false);
    expect(await findLiveHouseholdName(deps.db, a.householdId)).toBeNull();
    expect(await deps.db.transaction((tx) => lockLiveHousehold(tx, a.householdId))).toBe(false);
    expect(await deps.db.transaction((tx) => lockLiveHousehold(tx, id()))).toBe(false);
  });
});

describe('出来事の記録', () => {
  it('配れていないものだけが古い順に出て、配達済みにすると出なくなる', async () => {
    const e1 = id();
    const e2 = id();
    await insertEvent(deps.db, {
      eventId: e1,
      name: 'household.deleted',
      payload: { eventId: e1, householdId: id() },
      occurredAt: clock.now(),
    });
    clock.advanceMs(10);
    await insertEvent(deps.db, {
      eventId: e2,
      name: 'account.deleted',
      payload: { eventId: e2, accountId: id() },
      occurredAt: clock.now(),
    });
    const pending = (await listUndeliveredEvents(deps.db)).filter((e) =>
      [e1, e2].includes(e.eventId),
    );
    expect(pending.map((e) => e.eventId)).toEqual([e1, e2]);
    await markEventDelivered(deps.db, e1, clock.now());
    const after = (await listUndeliveredEvents(deps.db)).filter((e) =>
      [e1, e2].includes(e.eventId),
    );
    expect(after.map((e) => e.eventId)).toEqual([e2]);
  });
});
