import type { AppDeps } from '@/domain/deps';
import { redeliverPendingEvents } from './events';
import { ensureAdminHandlers } from './handlers';

export { deleteAccount } from './account';
export { ensureAdminHandlers } from './handlers';
export {
  InvitationExpiredError,
  issueInvitation,
  joinHousehold,
  previewInvitation,
} from './invitation';
export {
  createDevOutboxSender,
  devMailOutboxEnabled,
  getMailSender,
  readDevOutbox,
  setMailSender,
  type MailMessage,
  type MailSenderPort,
} from './mail';
export { getHouseholdOverview, leaveHousehold } from './membership';
export {
  RESET_REQUEST_MESSAGE,
  confirmPasswordReset,
  requestPasswordReset,
} from './password-reset';

/** 配れていない出来事を配り直す。起動のとき・一定の間隔で呼ぶ（BR50.23）。配った件数を返す */
export async function redeliverEvents(deps: AppDeps): Promise<number> {
  ensureAdminHandlers(deps);
  return redeliverPendingEvents(deps);
}
