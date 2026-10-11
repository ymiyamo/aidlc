import type { Queryable } from '@/db/types';

export interface AccountRow {
  accountId: string;
  email: string;
  passwordDigest: string;
  displayName: string | null;
}

interface RawAccount {
  account_id: string;
  email: string;
  password_digest: string;
  display_name: string | null;
}

const COLUMNS = 'account_id, email, password_digest, display_name';

const toAccount = (r: RawAccount): AccountRow => ({
  accountId: r.account_id,
  email: r.email,
  passwordDigest: r.password_digest,
  displayName: r.display_name,
});

/** 作れたら Account、メールアドレスが重複していたら null（BR1.2。同時でも 1 件） */
export async function insertAccount(
  q: Queryable,
  a: { accountId: string; email: string; passwordDigest: string; displayName?: string | null },
): Promise<AccountRow | null> {
  const res = await q.query<RawAccount>(
    `insert into accounts (account_id, email, password_digest, display_name) values ($1, $2, $3, $4)
     on conflict do nothing returning ${COLUMNS}`,
    [a.accountId, a.email, a.passwordDigest, a.displayName ?? null],
  );
  return res.rows[0] ? toAccount(res.rows[0]) : null;
}

export async function findAccountByEmail(q: Queryable, email: string): Promise<AccountRow | null> {
  const res = await q.query<RawAccount>(
    `select ${COLUMNS} from accounts where lower(email) = lower($1)`,
    [email],
  );
  return res.rows[0] ? toAccount(res.rows[0]) : null;
}

export async function findAccountById(q: Queryable, accountId: string): Promise<AccountRow | null> {
  const res = await q.query<RawAccount>(`select ${COLUMNS} from accounts where account_id = $1`, [
    accountId,
  ]);
  return res.rows[0] ? toAccount(res.rows[0]) : null;
}
