import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppDeps } from '@/domain/deps';
import { CSRF_COOKIE, CSRF_HEADER, parseCookies } from './http';

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const newCsrfToken = () => randomBytes(24).toString('base64url');

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * 自分のサイトの URL（Origin の照合の基準）。設定があればそれを使う。
 * 未設定のとき、本番ではリクエストの Host を信用せず null（＝拒否）、開発・テストでは URL から判断する
 */
function expectedOrigin(req: Request, deps: AppDeps): string | null {
  if (deps.config.appOrigin) return deps.config.appOrigin;
  return deps.config.requireAppOrigin ? null : new URL(req.url).origin;
}

/** (1) Origin（なければ Referer）が自分のサイトであること */
export function originMatches(req: Request, deps: AppDeps): boolean {
  const expected = expectedOrigin(req, deps);
  if (expected === null) return false;
  const origin = req.headers.get('origin');
  if (origin) return origin === expected;
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return false;
}

/** (2) ヘッダーの合言葉が、Cookie の合言葉と一致すること（NFR3.11） */
export function tokenMatches(req: Request): boolean {
  const header = req.headers.get(CSRF_HEADER);
  const cookie = parseCookies(req.headers.get('cookie'))[CSRF_COOKIE];
  return Boolean(header && cookie && safeEqual(header, cookie));
}

/** 状態を変えるリクエストは、両方そろわなければ拒否する */
export function csrfOk(req: Request, deps: AppDeps): boolean {
  return originMatches(req, deps) && tokenMatches(req);
}
