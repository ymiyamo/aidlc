import { findAccountById } from '@/repo/accounts';
import {
  getHousehold,
  insertHousehold,
  insertMember,
  listMembers,
  type MemberRow,
} from '@/repo/households';
import type { AppDeps } from './deps';
import { DomainError, notFound } from './errors';
import { ensureSeeds, type SeedStatus } from './seed';
import { householdSchema, parseOrThrow } from './validation';

/** BR2.1、BR2.2、BR2.6：グループを作り、作った人を最初のメンバーにして、household.created を出す */
export async function createHousehold(
  deps: AppDeps,
  accountId: string,
  raw: unknown,
): Promise<{ householdId: string; memberId: string }> {
  const { name } = parseOrThrow(householdSchema, raw);
  const account = await findAccountById(deps.db, accountId);
  if (!account) throw notFound();
  const householdId = deps.newId();
  const memberId = deps.newId();
  const now = deps.now();

  // Household と Member は 1 つの処理。Member が作れなければ（すでに所属）両方取り消す
  await deps.db.transaction(async (tx) => {
    await insertHousehold(tx, { householdId, name, createdAt: now });
    const ok = await insertMember(tx, {
      memberId,
      householdId,
      accountId,
      displayName: account.displayName ?? account.email.split('@')[0].slice(0, 50),
      joinedAt: now,
    });
    if (!ok) throw new DomainError('conflict', 'すでにグループに入っています');
  });

  // 作成が確定したあとで出来事を出す。受け手が失敗しても作成は取り消さない
  await deps.events.publish('household.created', { householdId });
  return { householdId, memberId };
}

/** BR2.5：退会した（または名前が消えた）メンバーの表示 */
export const memberLabel = (m: Pick<MemberRow, 'displayName' | 'leftAt'>) =>
  m.leftAt || !m.displayName ? '退会したメンバー' : m.displayName;

export async function listHouseholdMembers(deps: AppDeps, householdId: string) {
  const members = await listMembers(deps.db, householdId);
  return members.map((m) => ({ memberId: m.memberId, displayName: memberLabel(m) }));
}

/** ホームを開いたとき：不足している初期データを補ってから状態を返す（BR3.12） */
export async function prepareHome(
  deps: AppDeps,
  householdId: string,
): Promise<{ household: { householdId: string; name: string }; seedStatus: SeedStatus }> {
  const household = await getHousehold(deps.db, householdId);
  if (!household) throw notFound();
  const { status } = await ensureSeeds(deps, householdId);
  return { household, seedStatus: status };
}
