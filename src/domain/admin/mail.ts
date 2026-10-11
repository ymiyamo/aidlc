import { randomUUID } from 'node:crypto';
import { insertOutboxMail, purgeExpiredOutbox, findLatestOutboxMail } from '@/repo/admin/resets';
import type { AppDeps } from '@/domain/deps';

/** メール送信の窓口（C5）。宛先・件名・本文を受け取る。外部のサービスは、この窓口の裏に差し替える */
export interface MailMessage {
  accountId: string;
  to: string;
  subject: string;
  body: string;
  /** この日時を過ぎたら、通し版の送信箱では見えなくなる（BR50.25） */
  expiresAt: Date;
}
export interface MailSenderPort {
  send(msg: MailMessage): Promise<void>;
}

/** 開発用の送信箱を使ってよい設定か。本番（requireAppOrigin が true）では無効（BR50.25） */
export const devMailOutboxEnabled = (deps: AppDeps) => !deps.config.requireAppOrigin;

/** 通し版の代替：実際には送らず、DevMailOutbox に記録する。本文はログに出さない（BR50.26） */
export function createDevOutboxSender(deps: AppDeps): MailSenderPort {
  return {
    async send(m) {
      const now = deps.now();
      await purgeExpiredOutbox(deps.db, now);
      await insertOutboxMail(deps.db, {
        outboxId: randomUUID(),
        accountId: m.accountId,
        to: m.to,
        subject: m.subject,
        body: m.body,
        createdAt: now,
        expiresAt: m.expiresAt,
      });
    },
  };
}

const overrides = new WeakMap<AppDeps, MailSenderPort>();

/** 送信の窓口を差し替える（外部のサービスを入れるとき、テスト） */
export function setMailSender(deps: AppDeps, sender: MailSenderPort | null) {
  if (sender) overrides.set(deps, sender);
  else overrides.delete(deps);
}

/** 差し替えがなければ、開発用の送信箱。送信箱も無効な設定なら、運用者に分かる形で記録するだけ（BR50.25） */
export function getMailSender(deps: AppDeps): MailSenderPort {
  const custom = overrides.get(deps);
  if (custom) return custom;
  if (devMailOutboxEnabled(deps)) return createDevOutboxSender(deps);
  return {
    async send() {
      deps.logger.error('mail_sender_not_configured', {});
    },
  };
}

/** 開発用の送信箱の最新の 1 通。無効な設定では null */
export async function readDevOutbox(deps: AppDeps, to: string) {
  if (!devMailOutboxEnabled(deps)) return null;
  return findLatestOutboxMail(deps.db, to, deps.now());
}
