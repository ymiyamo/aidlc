import {
  InvitationExpiredError,
  RESET_REQUEST_MESSAGE,
  confirmPasswordReset,
  deleteAccount,
  devMailOutboxEnabled,
  getHouseholdOverview,
  issueInvitation,
  joinHousehold,
  leaveHousehold,
  previewInvitation,
  readDevOutbox,
  requestPasswordReset,
} from '@/domain/admin';
import type { Principal } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { notFound } from '@/domain/errors';
import { SESSION_COOKIE, json, serializeCookie } from '../http';

/**
 * U7（グループとアカウントの管理）の API。
 * 入口（src/api/router.ts）の `routes` に `...adminRoutes` を足して登録する。
 * 認証・グループの決定・CSRF は入口が行う（ADR-005）。ここでは householdId を画面の入力から受け取らない（BR50.14）
 */
export interface AdminRouteContext {
  req: Request;
  deps: AppDeps;
  params: string[];
  query: URLSearchParams;
  body: unknown;
  principal: Principal | null;
  household: HouseholdContext | null;
  sessionToken: string | null;
  cookies: string[];
}

export interface AdminRoute {
  method: string;
  pattern: RegExp;
  auth: 'none' | 'user' | 'household';
  /** ログ用の名前（ID や個人情報を含めない） */
  name: string;
  handler: (c: AdminRouteContext) => Promise<Response>;
}

const clearSessionCookie = (c: AdminRouteContext) =>
  serializeCookie(SESSION_COOKIE, '', { secure: c.deps.config.cookieSecure, maxAgeSeconds: 0 });

const RESET_LINK_RE = /(\/password\/reset\?token=[^\s]+)/;

export const adminRoutes: AdminRoute[] = [
  // ---------- パスワードの再設定（ログイン前でもできる。BR50.28） ----------
  {
    method: 'POST',
    pattern: /^\/api\/password-reset\/request$/,
    auth: 'none',
    name: 'password-reset.request',
    async handler(c) {
      await requestPasswordReset(c.deps, c.body);
      // 登録済みかどうかに関わらず、同じ応答（BR50.1）
      return json({ ok: true, message: RESET_REQUEST_MESSAGE });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/password-reset\/confirm$/,
    auth: 'none',
    name: 'password-reset.confirm',
    async handler(c) {
      await confirmPasswordReset(c.deps, c.body);
      // ログイン状態はすべて終わっている。自動ではログインしない（BR50.4）
      c.cookies.push(clearSessionCookie(c));
      return json({ ok: true });
    },
  },
  {
    // 通し版・開発の設定のときだけ。実際にはメールを送らないので、送信箱のリンクを画面に出す（BR50.25）
    method: 'GET',
    pattern: /^\/api\/dev\/mail-outbox$/,
    auth: 'none',
    name: 'dev.mail-outbox',
    async handler(c) {
      if (!devMailOutboxEnabled(c.deps)) throw notFound();
      const to = c.query.get('email') ?? '';
      const mail = to ? await readDevOutbox(c.deps, to) : null;
      return json({ link: mail?.body.match(RESET_LINK_RE)?.[1] ?? null });
    },
  },

  // ---------- 招待 ----------
  {
    method: 'POST',
    pattern: /^\/api\/invitations$/,
    auth: 'household',
    name: 'invitations.issue',
    async handler(c) {
      const issued = await issueInvitation(c.deps, c.household!);
      // リンクの値を返すのは、この 1 回だけ（BR50.9、BR50.10）
      return json(
        {
          path: `/join?token=${encodeURIComponent(issued.token)}`,
          expiresAt: issued.expiresAt.toISOString(),
        },
        201,
      );
    },
  },
  {
    // リンクを開いた人に、参加の前に見せる確認（ログイン前でもできる。BR50.11、BR50.28）。値を URL に載せないよう POST
    method: 'POST',
    pattern: /^\/api\/invitations\/preview$/,
    auth: 'none',
    name: 'invitations.preview',
    async handler(c) {
      return json(await previewInvitation(c.deps, c.body));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/invitations\/join$/,
    auth: 'user',
    name: 'invitations.join',
    async handler(c) {
      try {
        await joinHousehold(c.deps, c.principal!.accountId, c.body);
      } catch (err) {
        // 期限切れは 410（契約 C1。BR50.13）
        if (err instanceof InvitationExpiredError) {
          return json({ error: { code: 'expired', message: err.message } }, 410);
        }
        throw err;
      }
      return json({ ok: true }, 201);
    },
  },

  // ---------- グループ・アカウント ----------
  {
    method: 'GET',
    pattern: /^\/api\/admin\/overview$/,
    auth: 'household',
    name: 'admin.overview',
    async handler(c) {
      return json(await getHouseholdOverview(c.deps, c.household!.householdId));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/household\/leave$/,
    auth: 'user',
    name: 'household.leave',
    async handler(c) {
      const r = await leaveHousehold(c.deps, c.principal!.accountId, c.body);
      return json({ ok: true, householdDeleted: r.householdDeleted });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/account\/delete$/,
    auth: 'user',
    name: 'account.delete',
    async handler(c) {
      await deleteAccount(c.deps, c.principal!.accountId, c.body);
      c.cookies.push(clearSessionCookie(c));
      return json({ ok: true });
    },
  },
];
