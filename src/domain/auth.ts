import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { findAccountByEmail, findAccountById, insertAccount } from '@/repo/accounts';
import { findActiveMemberByAccount } from '@/repo/households';
import { deleteSession, findValidSessionAccount, insertSession } from '@/repo/sessions';
import type { AppDeps } from './deps';
import { DomainError } from './errors';
import { loginSchema, parseOrThrow, registerSchema } from './validation';

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/** bcrypt は先頭 72 バイトしか見ないので、先に SHA-256 で固定長にしてから変換する */
const prehash = (password: string) =>
  createHash('sha256').update(password, 'utf8').digest('base64');

export const hashPassword = (password: string, cost: number) =>
  bcrypt.hash(prehash(password), cost);
const verifyPassword = (password: string, digest: string) =>
  bcrypt.compare(prehash(password), digest);

/** Cookie に入れる、推測できないランダムな値 */
export const newSessionToken = () => randomBytes(32).toString('base64url');
/** DB に保存するのは、この変換値だけ（BR1.5） */
export const hashSessionToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export interface IssuedSession {
  accountId: string;
  token: string;
  expiresAt: Date;
}

async function issueSession(deps: AppDeps, accountId: string): Promise<IssuedSession> {
  const token = newSessionToken();
  const issuedAt = deps.now();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_MS);
  await insertSession(deps.db, {
    sessionHash: hashSessionToken(token),
    accountId,
    issuedAt,
    expiresAt,
  });
  return { accountId, token, expiresAt };
}

/** BR1.1〜BR1.4：登録してそのままログイン状態にする */
export async function register(deps: AppDeps, raw: unknown): Promise<IssuedSession> {
  const input = parseOrThrow(registerSchema, raw);
  const digest = await hashPassword(input.password, deps.bcryptCost);
  const account = await insertAccount(deps.db, {
    accountId: deps.newId(),
    email: input.email,
    passwordDigest: digest,
    displayName: input.displayName ?? input.email.split('@')[0].slice(0, 50),
  });
  // 登録済みかどうかを教えすぎない文言にする（BR1.2）
  if (!account) throw new DomainError('conflict', '登録できません');
  return issueSession(deps, account.accountId);
}

// 存在しないメールアドレスでも同じ時間がかかるようにするための見せかけの値
let dummyDigest: Promise<string> | null = null;

/** BR1.6：どちらが違うかは教えない */
export async function login(deps: AppDeps, raw: unknown): Promise<IssuedSession> {
  const input = parseOrThrow(loginSchema, raw);
  const account = await findAccountByEmail(deps.db, input.email);
  dummyDigest ??= hashPassword('dummy-password', deps.bcryptCost);
  const ok = await verifyPassword(input.password, account?.passwordDigest ?? (await dummyDigest));
  if (!account || !ok) {
    throw new DomainError('auth_failed', 'メールアドレスまたはパスワードが違います');
  }
  return issueSession(deps, account.accountId);
}

export async function logout(deps: AppDeps, token: string | null): Promise<void> {
  if (token) await deleteSession(deps.db, hashSessionToken(token));
}

export interface Principal {
  accountId: string;
  email: string;
  displayName: string | null;
  /** グループに入っていなければ null（BR2.3） */
  household: { householdId: string; memberId: string } | null;
}

/**
 * Cookie の値 → LoginSession → Account → 有効な Member → householdId（BR2.3、ADR-005）。
 * 無効なら null。
 */
export async function authenticate(deps: AppDeps, token: string | null): Promise<Principal | null> {
  if (!token) return null;
  const accountId = await findValidSessionAccount(deps.db, hashSessionToken(token), deps.now());
  if (!accountId) return null;
  const account = await findAccountById(deps.db, accountId);
  if (!account) return null;
  const member = await findActiveMemberByAccount(deps.db, accountId);
  return {
    accountId,
    email: account.email,
    displayName: member?.displayName ?? account.displayName,
    household: member ? { householdId: member.householdId, memberId: member.memberId } : null,
  };
}
