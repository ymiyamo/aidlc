import { findAccountById } from '@/repo/accounts';
import { insertMember } from '@/repo/households';
import {
  countActiveInvitations,
  findInvitationByDigest,
  insertInvitation,
  markInvitationUsed,
} from '@/repo/admin/invitations';
import {
  findActiveMembership,
  findLiveHouseholdName,
  lockLiveHousehold,
} from '@/repo/admin/membership';
import type { AppDeps } from '@/domain/deps';
import { DomainError, notFound } from '@/domain/errors';
import type { HouseholdContext } from '@/domain/dish';
import { parseOrThrow } from '@/domain/validation';
import { digestLinkToken, newLinkToken } from './tokens';
import { joinSchema, tokenSchema } from './validation';

export const INVITE_DAYS = 7;
export const INVITE_MAX_ACTIVE = 10;
const INVITE_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;

const UNUSABLE = 'このリンクは使えません';
const EXPIRED =
  'このリンクは期限が切れています。招待した人に、新しいリンクを発行してもらってください';

/** 期限切れ（契約 C1 では 410）。API の入口で 410 にする（BR50.13） */
export class InvitationExpiredError extends DomainError {
  constructor() {
    super('not_found', EXPIRED);
    this.name = 'InvitationExpiredError';
  }
}

export interface IssuedInvitation {
  /** リンクの元の値。この応答に 1 度だけ載せる。保存しない（BR50.10） */
  token: string;
  expiresAt: Date;
}

/** BR50.9：グループのメンバーが、自分のグループの招待を発行する。同時に有効なのは 10 本まで */
export async function issueInvitation(
  deps: AppDeps,
  ctx: HouseholdContext,
): Promise<IssuedInvitation> {
  const token = newLinkToken();
  const issuedAt = deps.now();
  const expiresAt = new Date(issuedAt.getTime() + INVITE_MS);
  await deps.db.transaction(async (tx) => {
    // 発行先は、ログイン状態から決めたグループだけ（BR50.14）。数える前にロックして、同時でも 10 本を超えない
    if (!(await lockLiveHousehold(tx, ctx.householdId))) throw notFound();
    if ((await countActiveInvitations(tx, ctx.householdId, issuedAt)) >= INVITE_MAX_ACTIVE) {
      throw new DomainError(
        'conflict',
        '有効な招待リンクがいっぱいです。期限が切れるのを待つか、使われるのを待ってください',
      );
    }
    await insertInvitation(tx, {
      invitationId: deps.newId(),
      householdId: ctx.householdId,
      tokenDigest: digestLinkToken('invite', token),
      issuedBy: ctx.memberId,
      issuedAt,
      expiresAt,
    });
  });
  return { token, expiresAt };
}

export type InvitationPreview =
  { status: 'valid'; householdName: string } | { status: 'expired' } | { status: 'unusable' };

/** BR50.11：リンクを開いた人に、参加する前にグループ名と、参加できるかどうかを見せる（人数や名前は見せない） */
export async function previewInvitation(deps: AppDeps, raw: unknown): Promise<InvitationPreview> {
  const { token } = parseOrThrow(tokenSchema, raw);
  const inv = await findInvitationByDigest(deps.db, digestLinkToken('invite', token));
  if (!inv || inv.usedAt) return { status: 'unusable' };
  const name = await findLiveHouseholdName(deps.db, inv.householdId);
  if (name === null) return { status: 'unusable' };
  if (inv.expiresAt.getTime() <= deps.now().getTime()) return { status: 'expired' };
  return { status: 'valid', householdName: name };
}

/**
 * BR50.12：有効なリンクを使う人が、どのグループにも入っていないときだけ参加できる。
 * Member の追加と使用済みの印は 1 つの処理。同じリンクを同時に使っても成り立つのは 1 人
 */
export async function joinHousehold(
  deps: AppDeps,
  accountId: string,
  raw: unknown,
): Promise<{ householdId: string; memberId: string }> {
  const input = parseOrThrow(joinSchema, raw);
  const digest = digestLinkToken('invite', input.token);
  const first = await findInvitationByDigest(deps.db, digest);
  if (!first) throw new DomainError('not_found', UNUSABLE);
  const account = await findAccountById(deps.db, accountId);
  if (!account) throw notFound();
  const displayName = input.displayName ?? account.email.split('@')[0].slice(0, 50);
  const memberId = deps.newId();
  const now = deps.now();

  await deps.db.transaction(async (tx) => {
    // 参加先 = リンクの Invitation.householdId のみ（BR50.14）。グループの行をロックして、退会・削除と直列にする
    if (!(await lockLiveHousehold(tx, first.householdId))) {
      throw new DomainError('not_found', UNUSABLE);
    }
    const inv = await findInvitationByDigest(tx, digest);
    if (!inv || inv.usedAt) throw new DomainError('not_found', UNUSABLE);
    if (inv.expiresAt.getTime() <= now.getTime()) throw new InvitationExpiredError();
    // 同じグループでも、別のグループでも、すでに所属していれば参加しない。リンクは使用済みにしない
    if (await findActiveMembership(tx, accountId)) {
      throw new DomainError('conflict', '先に今のグループから抜けてください');
    }
    if (!(await markInvitationUsed(tx, inv.invitationId, accountId, now))) {
      throw new DomainError('not_found', UNUSABLE);
    }
    const ok = await insertMember(tx, {
      memberId,
      householdId: inv.householdId,
      accountId,
      displayName,
      joinedAt: now,
    });
    // 失敗したら、使用済みの印も含めて取り消される
    if (!ok) throw new DomainError('conflict', '先に今のグループから抜けてください');
  });
  return { householdId: first.householdId, memberId };
}
