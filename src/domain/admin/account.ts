import {
  clearDeleteFailures,
  clearExpiredDeleteLock,
  getDeletionState,
  markAccountDeleted,
  recordDeleteFailure,
} from '@/repo/admin/membership';
import {
  deleteOutboxOfAccount,
  deleteResetsOfAccount,
  deleteSessionsOfAccount,
} from '@/repo/admin/resets';
import { verifyPassword } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { DomainError } from '@/domain/errors';
import { parseOrThrow } from '@/domain/validation';
import type { EventRecord } from '@/repo/admin/events';
import { publishRecorded, recordEvent } from './events';
import { ensureAdminHandlers } from './handlers';
import { deleteAccountSchema } from './validation';

/** アカウント削除の再入力を、続けてまちがえてよい回数と、受け付けない時間（BR50.19。暫定） */
export const DELETE_MAX_FAILURES = 5;
export const DELETE_LOCK_MS = 15 * 60 * 1000;

/**
 * BR50.19、BR50.20：パスワードの再入力が一致したときだけ、アカウントを削除する。
 * メールアドレス・パスワードの変換値・表示名を空にし、ログイン状態・再設定のリンク・送信箱を消し、
 * account.deleted を記録する。グループからの退会は、この出来事の受け口が行う（BR50.21）
 */
export async function deleteAccount(deps: AppDeps, accountId: string, raw: unknown): Promise<void> {
  ensureAdminHandlers(deps);
  const input = parseOrThrow(deleteAccountSchema, raw);
  const now = deps.now();
  await clearExpiredDeleteLock(deps.db, accountId, now);
  const state = await getDeletionState(deps.db, accountId);
  if (!state || state.deleted) return; // すでに削除済み（冪等）
  if (state.deleteLockedUntil && state.deleteLockedUntil.getTime() > now.getTime()) {
    throw new DomainError(
      'auth_failed',
      'パスワードの確認に続けて失敗したため、しばらくこの操作はできません（約 15 分）',
      undefined,
      { locked: true },
    );
  }
  // ログインの失敗の回数（BR50.5）には数えない。削除の確認だけの別の数え方
  if (!state.passwordDigest || !(await verifyPassword(input.password, state.passwordDigest))) {
    await recordDeleteFailure(deps.db, accountId, now, DELETE_MAX_FAILURES, DELETE_LOCK_MS);
    throw new DomainError('auth_failed', 'パスワードが違います');
  }
  await clearDeleteFailures(deps.db, accountId);

  const events: EventRecord[] = [];
  await deps.db.transaction(async (tx) => {
    if (!(await markAccountDeleted(tx, accountId, now))) return;
    await deleteSessionsOfAccount(tx, accountId);
    await deleteResetsOfAccount(tx, accountId);
    await deleteOutboxOfAccount(tx, accountId);
    events.push(await recordEvent(tx, deps, 'account.deleted', { accountId }));
  });
  await publishRecorded(deps, events);
}
