import type { Queryable } from '@/db/types';

export interface HouseholdRow {
  householdId: string;
  name: string;
}

export interface MemberRow {
  memberId: string;
  householdId: string;
  displayName: string | null;
  leftAt: Date | null;
}

interface RawMember {
  member_id: string;
  household_id: string;
  display_name: string | null;
  left_at: Date | null;
}

const toMember = (r: RawMember): MemberRow => ({
  memberId: r.member_id,
  householdId: r.household_id,
  displayName: r.display_name,
  leftAt: r.left_at,
});

export async function insertHousehold(
  q: Queryable,
  h: { householdId: string; name: string; createdAt: Date },
): Promise<void> {
  await q.query('insert into households (household_id, name, created_at) values ($1, $2, $3)', [
    h.householdId,
    h.name,
    h.createdAt,
  ]);
}

/** 有効な Member を作る。すでに所属していたら null（BR2.1。同時でも 1 件） */
export async function insertMember(
  q: Queryable,
  m: {
    memberId: string;
    householdId: string;
    accountId: string;
    displayName: string;
    joinedAt: Date;
  },
): Promise<boolean> {
  const res = await q.query(
    `insert into members (member_id, household_id, account_id, display_name, joined_at)
     values ($1, $2, $3, $4, $5) on conflict do nothing`,
    [m.memberId, m.householdId, m.accountId, m.displayName, m.joinedAt],
  );
  return res.rowCount === 1;
}

/** アカウントの有効な Member（グループを決める入口で使う。BR2.3） */
export async function findActiveMemberByAccount(
  q: Queryable,
  accountId: string,
): Promise<MemberRow | null> {
  const res = await q.query<RawMember>(
    `select member_id, household_id, display_name, left_at from members
     where account_id = $1 and left_at is null`,
    [accountId],
  );
  return res.rows[0] ? toMember(res.rows[0]) : null;
}

export async function getHousehold(
  q: Queryable,
  householdId: string,
): Promise<HouseholdRow | null> {
  const res = await q.query<{ household_id: string; name: string }>(
    'select household_id, name from households where household_id = $1',
    [householdId],
  );
  return res.rows[0] ? { householdId: res.rows[0].household_id, name: res.rows[0].name } : null;
}

export async function listMembers(q: Queryable, householdId: string): Promise<MemberRow[]> {
  const res = await q.query<RawMember>(
    `select member_id, household_id, display_name, left_at from members
     where household_id = $1 order by joined_at, member_id`,
    [householdId],
  );
  return res.rows.map(toMember);
}
