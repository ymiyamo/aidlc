import type { AppDeps } from '@/domain/deps';
import { leaveByAccount } from './membership';

const registered = new WeakSet<AppDeps>();

/**
 * 出来事の受け口を登録する（何度呼んでも 1 回だけ）。
 * account.deleted を受けたら、そのアカウントの有効なメンバーを退会にし、最後の 1 人ならグループを削除する（BR50.21）。
 * 同じ出来事を何度受けても結果は同じ（BR50.24）
 */
export function ensureAdminHandlers(deps: AppDeps): void {
  if (registered.has(deps)) return;
  registered.add(deps);
  deps.events.subscribe('account.deleted', async ({ accountId }) => {
    await leaveByAccount(deps, accountId);
  });
}
