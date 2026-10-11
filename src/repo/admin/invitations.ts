import type { Queryable } from '@/db/types';

export interface InvitationRow {
  invitationId: string;
  householdId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface RawInvitation {
  invitation_id: string;
  household_id: string;
  expires_at: Date;
  used_at: Date | null;
}

const toInvitation = (r: RawInvitation): InvitationRow => ({
  invitationId: r.invitation_id,
  householdId: r.household_id,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
});

/** 招待を探す。リンクの値の変換値だけで探す（BR50.10）。householdId は結果から決める（BR50.14） */
export async function findInvitationByDigest(
  q: Queryable,
  tokenDigest: string,
): Promise<InvitationRow | null> {
  const res = await q.query<RawInvitation>(
    `select invitation_id, household_id, expires_at, used_at from invitations
     where token_digest = $1`,
    [tokenDigest],
  );
  return res.rows[0] ? toInvitation(res.rows[0]) : null;
}

/** 有効な招待の本数（グループごと。使用済みと期限切れは数えない。BR50.9） */
export async function countActiveInvitations(
  q: Queryable,
  householdId: string,
  now: Date,
): Promise<number> {
  const res = await q.query<{ n: number | string }>(
    `select count(*) as n from invitations
     where household_id = $1 and used_at is null and expires_at > $2`,
    [householdId, now],
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function insertInvitation(
  q: Queryable,
  i: {
    invitationId: string;
    householdId: string;
    tokenDigest: string;
    issuedBy: string;
    issuedAt: Date;
    expiresAt: Date;
  },
): Promise<void> {
  await q.query(
    `insert into invitations (invitation_id, household_id, token_digest, issued_by, issued_at, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [i.invitationId, i.householdId, i.tokenDigest, i.issuedBy, i.issuedAt, i.expiresAt],
  );
}

/**
 * 使用済みにする。有効なもの（未使用で期限内）だけが対象で、成り立つのは 1 回だけ。
 * 同じリンクを同時に 2 人が使っても、true が返るのは 1 人（BR50.12）
 */
export async function markInvitationUsed(
  q: Queryable,
  invitationId: string,
  usedBy: string,
  now: Date,
): Promise<boolean> {
  const res = await q.query(
    `update invitations set used_at = $3, used_by = $2
     where invitation_id = $1 and used_at is null and expires_at > $3`,
    [invitationId, usedBy, now],
  );
  return res.rowCount === 1;
}

/** グループ削除のとき、そのグループの招待をすべて消す（BR50.22）。件数を返す */
export async function deleteInvitationsOfHousehold(
  q: Queryable,
  householdId: string,
): Promise<number> {
  const res = await q.query('delete from invitations where household_id = $1', [householdId]);
  return res.rowCount;
}
