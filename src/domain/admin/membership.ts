import { deleteInvitationsOfHousehold } from '@/repo/admin/invitations';
import {
  countActiveMembers,
  findActiveMembership,
  findLiveHouseholdName,
  lockLiveHousehold,
  markHouseholdDeleted,
  markMemberLeft,
} from '@/repo/admin/membership';
import type { EventRecord } from '@/repo/admin/events';
import type { AppDeps } from '@/domain/deps';
import { DomainError, notFound } from '@/domain/errors';
import { parseOrThrow } from '@/domain/validation';
import { publishRecorded, recordEvent } from './events';
import { leaveSchema } from './validation';

export interface LeaveResult {
  /** 今回の操作で、実際に退会にした（すでに退会済みなら false。冪等） */
  left: boolean;
  /** 最後の 1 人だったので、グループを削除した */
  householdDeleted: boolean;
}

/**
 * 退会（BR50.16）と、最後の 1 人ならグループ削除（BR50.22）。
 * 同じグループの参加・退会・人数の判定・削除は、グループの行のロックで 1 件ずつ確定する（直列）。
 * 出来事は同じ処理の中で記録し、確定のあとで配る（BR50.23）
 */
export async function leaveByAccount(
  deps: AppDeps,
  accountId: string,
  opts: { requireLastConfirm?: boolean; confirmLast?: boolean } = {},
): Promise<LeaveResult> {
  const first = await findActiveMembership(deps.db, accountId);
  if (!first) return { left: false, householdDeleted: false };

  const events: EventRecord[] = [];
  const result = await deps.db.transaction(async (tx): Promise<LeaveResult> => {
    await lockLiveHousehold(tx, first.householdId);
    // ロックを待つ間に退会済みになっていないか、確かめ直す（冪等）
    const m = await findActiveMembership(tx, accountId);
    if (!m) return { left: false, householdDeleted: false };
    const isLast = (await countActiveMembers(tx, m.householdId)) === 1;
    if (isLast && opts.requireLastConfirm && !opts.confirmLast) {
      throw new DomainError(
        'conflict',
        'あなたが最後のメンバーです。抜けると、グループの料理、記録、献立、買い物リストなどのデータがすべて削除されます',
        undefined,
        { needsLastConfirm: true },
      );
    }
    if (!(await markMemberLeft(tx, m.memberId, deps.now()))) {
      return { left: false, householdDeleted: false };
    }
    events.push(
      await recordEvent(tx, deps, 'household.member-left', {
        householdId: m.householdId,
        memberId: m.memberId,
      }),
    );
    let householdDeleted = false;
    if (isLast && (await markHouseholdDeleted(tx, m.householdId, deps.now()))) {
      await deleteInvitationsOfHousehold(tx, m.householdId);
      events.push(await recordEvent(tx, deps, 'household.deleted', { householdId: m.householdId }));
      householdDeleted = true;
    }
    return { left: true, householdDeleted };
  });
  await publishRecorded(deps, events);
  return result;
}

/** 「グループから抜ける」の確認のあとの操作。確認がなければ何も変えない（BR50.19） */
export async function leaveHousehold(
  deps: AppDeps,
  accountId: string,
  raw: unknown,
): Promise<LeaveResult> {
  const input = parseOrThrow(leaveSchema, raw);
  return leaveByAccount(deps, accountId, {
    requireLastConfirm: true,
    confirmLast: input.confirmLast === true,
  });
}

/** 設定画面の表示用：グループ名と、有効なメンバーの数（自分が最後かどうかの案内に使う） */
export async function getHouseholdOverview(deps: AppDeps, householdId: string) {
  const householdName = await findLiveHouseholdName(deps.db, householdId);
  if (householdName === null) throw notFound();
  return { householdName, activeMemberCount: await countActiveMembers(deps.db, householdId) };
}
