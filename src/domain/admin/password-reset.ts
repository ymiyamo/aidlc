import { findAccountByEmail } from '@/repo/accounts';
import {
  consumeReset,
  countResetsSince,
  deleteSessionsOfAccount,
  findResetByDigest,
  insertReset,
  invalidateActiveResets,
  setPasswordAndUnlock,
} from '@/repo/admin/resets';
import { hashPassword } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { DomainError } from '@/domain/errors';
import { parseOrThrow } from '@/domain/validation';
import { getMailSender } from './mail';
import { digestLinkToken, newLinkToken } from './tokens';
import { newPasswordSchema, resetRequestSchema, tokenOnlySchema } from './validation';

export const RESET_TTL_MS = 60 * 60 * 1000;
export const RESET_LIMIT_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

/** どんな場合も同じ文言で応える（BR50.1）。登録されているかどうかを教えない */
export const RESET_REQUEST_MESSAGE =
  '登録されているメールアドレスなら、パスワード再設定の案内を送りました';

const LINK_ERROR = 'このリンクは使えません。もう一度、再設定を要求してください';

/** 再設定のリンクの形。origin が決まっていれば絶対 URL、なければ相対（通し版の画面表示用） */
export const resetPath = (token: string) => `/password/reset?token=${encodeURIComponent(token)}`;

/**
 * BR50.1〜BR50.3：再設定のリンクを作り、メールの窓口に渡す。
 * 未登録・削除済み・上限超過でも、何も教えずに正常に終わる
 */
export async function requestPasswordReset(deps: AppDeps, raw: unknown): Promise<void> {
  const { email } = parseOrThrow(resetRequestSchema, raw);
  const account = await findAccountByEmail(deps.db, email);
  if (!account) return;

  const token = newLinkToken();
  const issuedAt = deps.now();
  const expiresAt = new Date(issuedAt.getTime() + RESET_TTL_MS);
  const created = await deps.db.transaction(async (tx) => {
    // 同じアカウントの発行を 1 件ずつ確定する（上限の判定を同時に抜けられない）
    await tx.query('select account_id from accounts where account_id = $1 for update', [
      account.accountId,
    ]);
    const since = new Date(issuedAt.getTime() - HOUR_MS);
    if ((await countResetsSince(tx, account.accountId, since)) >= RESET_LIMIT_PER_HOUR) {
      return false;
    }
    // 同時に有効なのは 1 本（BR50.3）
    await invalidateActiveResets(tx, account.accountId, issuedAt);
    await insertReset(tx, {
      resetId: deps.newId(),
      accountId: account.accountId,
      tokenDigest: digestLinkToken('reset', token),
      issuedAt,
      expiresAt,
    });
    return true;
  });
  if (!created) {
    // 応答は変えない。運用者には分かる形で記録する（BR50.2、BR50.26：ID だけ）
    deps.logger.warn('password_reset_limit_reached', { accountId: account.accountId });
    return;
  }
  const origin = deps.config.appOrigin ?? '';
  try {
    await getMailSender(deps).send({
      accountId: account.accountId,
      to: account.email,
      subject: 'パスワードの再設定',
      body: `次のリンクを開いて、新しいパスワードを設定してください（60 分間有効、1 回だけ使えます）。\n${origin}${resetPath(token)}`,
      expiresAt,
    });
  } catch (err) {
    // 送れなくても応答は変えない（BR50.1）
    deps.logger.error('password_reset_mail_failed', { accountId: account.accountId, error: err });
  }
}

const linkError = () => new DomainError('validation', LINK_ERROR, { token: LINK_ERROR });

/**
 * BR50.4：有効なリンクと 8 文字以上の新しいパスワードがそろったときだけ成功する。
 * 成功したら、リンクを使用済みにし、すべてのログイン状態を終わらせ、ロックを解く（自動ではログインしない）
 */
export async function confirmPasswordReset(deps: AppDeps, raw: unknown): Promise<void> {
  const parsed = tokenOnlySchema.safeParse(raw ?? {});
  if (!parsed.success) throw linkError();
  const digest = digestLinkToken('reset', parsed.data.token);
  // リンクの問題は、理由を区別せず同じ表示にする。パスワードの問題ではリンクを使用済みにしない
  if (!(await findResetByDigest(deps.db, digest, deps.now()))) throw linkError();
  const { password } = parseOrThrow(newPasswordSchema, raw);
  const passwordDigest = await hashPassword(password, deps.bcryptCost);

  await deps.db.transaction(async (tx) => {
    // 使用済みにできるのは 1 回だけ。同時に 2 回確定しても成功は 1 回
    const accountId = await consumeReset(tx, digest, deps.now());
    if (!accountId) throw linkError();
    await setPasswordAndUnlock(tx, accountId, passwordDigest);
    await deleteSessionsOfAccount(tx, accountId);
  });
}
