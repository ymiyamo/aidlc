import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import { createTestDb } from '@/test-helpers/db';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const id = () => crypto.randomUUID();
const T0 = new Date('2026-01-01T00:00:00Z');
const T1 = new Date('2026-01-08T00:00:00Z');

async function account(email: string) {
  const accountId = id();
  await db.query('insert into accounts (account_id, email, password_digest) values ($1,$2,$3)', [
    accountId,
    email,
    'digest',
  ]);
  return accountId;
}
async function household() {
  const householdId = id();
  const memberId = id();
  const accountId = await account(`${memberId}@example.com`);
  await db.query('insert into households (household_id, name) values ($1,$2)', [householdId, 'g']);
  await db.query('insert into members (member_id, household_id, account_id) values ($1,$2,$3)', [
    memberId,
    householdId,
    accountId,
  ]);
  return { householdId, memberId, accountId };
}

describe('007 移行：アカウントの列（BR50.5、BR50.20）', () => {
  it('失敗の回数・ロック・削除の列に既定値がある', async () => {
    const a = await account('defaults@example.com');
    const r = await db.query<Record<string, unknown>>(
      'select failed_login_count, locked_until, delete_fail_count, deleted_at from accounts where account_id = $1',
      [a],
    );
    expect(r.rows[0]).toEqual({
      failed_login_count: 0,
      locked_until: null,
      delete_fail_count: 0,
      deleted_at: null,
    });
  });

  it('失敗の回数は負にできない', async () => {
    const a = await account('neg@example.com');
    await expect(
      db.query('update accounts set failed_login_count = -1 where account_id = $1', [a]),
    ).rejects.toThrow();
  });

  it('削除済みにするときは、メールアドレス・変換値・表示名を空にしないと拒否される', async () => {
    const a = await account('del@example.com');
    await expect(
      db.query('update accounts set deleted_at = now() where account_id = $1', [a]),
    ).rejects.toThrow();
    await db.query(
      'update accounts set deleted_at = now(), email = null, password_digest = null, display_name = null where account_id = $1',
      [a],
    );
  });

  it('メールアドレスが空の複数のアカウントがあっても、一意制約に当たらない', async () => {
    const a = await account('x1@example.com');
    const b = await account('x2@example.com');
    for (const x of [a, b]) {
      await db.query(
        'update accounts set deleted_at = now(), email = null, password_digest = null where account_id = $1',
        [x],
      );
    }
    const r = await db.query(
      'select 1 from accounts where email is null and account_id in ($1,$2)',
      [a, b],
    );
    expect(r.rows).toHaveLength(2);
  });
});

describe('007 移行：招待（BR50.9〜BR50.12）', () => {
  it('同じ変換値の招待は 2 つ作れない', async () => {
    const h = await household();
    const insert = () =>
      db.query(
        `insert into invitations (invitation_id, household_id, token_digest, issued_by, issued_at, expires_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [id(), h.householdId, 'same-digest', h.memberId, T0, T1],
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it('期限が発行より前の招待は作れない', async () => {
    const h = await household();
    await expect(
      db.query(
        `insert into invitations (invitation_id, household_id, token_digest, issued_by, issued_at, expires_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [id(), h.householdId, 'bad-expiry', h.memberId, T1, T0],
      ),
    ).rejects.toThrow();
  });

  it('使用済みの印と使った人は、片方だけでは入らない', async () => {
    const h = await household();
    const inv = id();
    await db.query(
      `insert into invitations (invitation_id, household_id, token_digest, issued_by, issued_at, expires_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [inv, h.householdId, 'half-used', h.memberId, T0, T1],
    );
    await expect(
      db.query('update invitations set used_at = $2 where invitation_id = $1', [inv, T0]),
    ).rejects.toThrow();
  });

  it('存在しないグループの招待は作れない', async () => {
    const h = await household();
    await expect(
      db.query(
        `insert into invitations (invitation_id, household_id, token_digest, issued_by, issued_at, expires_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [id(), id(), 'no-household', h.memberId, T0, T1],
      ),
    ).rejects.toThrow();
  });
});

describe('007 移行：再設定・送信箱・出来事', () => {
  it('再設定のリンクの変換値は一意', async () => {
    const a = await account('reset@example.com');
    const insert = () =>
      db.query(
        `insert into password_resets (reset_id, account_id, token_digest, issued_at, expires_at)
         values ($1,$2,$3,$4,$5)`,
        [id(), a, 'reset-digest', T0, T1],
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it('アカウントを消すと、再設定のリンクと送信箱も一緒に消える', async () => {
    const a = await account('cascade@example.com');
    await db.query(
      `insert into password_resets (reset_id, account_id, token_digest, issued_at, expires_at)
       values ($1,$2,$3,$4,$5)`,
      [id(), a, 'cascade-digest', T0, T1],
    );
    await db.query(
      `insert into dev_mail_outbox (outbox_id, account_id, to_address, subject, body, created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id(), a, 'cascade@example.com', 's', 'b', T0, T1],
    );
    await db.query('delete from accounts where account_id = $1', [a]);
    const r1 = await db.query('select 1 from password_resets where account_id = $1', [a]);
    const r2 = await db.query('select 1 from dev_mail_outbox where account_id = $1', [a]);
    expect(r1.rows).toHaveLength(0);
    expect(r2.rows).toHaveLength(0);
  });

  it('出来事の名前は決められたものだけ', async () => {
    await db.query(
      `insert into domain_events (event_id, name, payload, occurred_at) values ($1,$2,'{}'::jsonb,$3)`,
      [id(), 'household.deleted', T0],
    );
    await expect(
      db.query(
        `insert into domain_events (event_id, name, payload, occurred_at) values ($1,$2,'{}'::jsonb,$3)`,
        [id(), 'something.else', T0],
      ),
    ).rejects.toThrow();
  });
});
