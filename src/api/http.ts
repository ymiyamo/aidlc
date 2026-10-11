import { DomainError, type DomainErrorCode } from '@/domain/errors';
import type { Dish } from '@/repo/dishes';

export const SESSION_COOKIE = 'mp_session';
export const CSRF_COOKIE = 'mp_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const STATUS: Record<DomainErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  auth_failed: 401,
  no_household: 403,
  not_found: 404,
  conflict: 409,
  duplicate_url: 409,
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(
  code: DomainErrorCode | 'csrf' | 'bad_request' | 'internal',
  message: string,
  extra: Record<string, unknown> = {},
) {
  const status =
    code === 'csrf' ? 403 : code === 'bad_request' ? 400 : code === 'internal' ? 500 : STATUS[code];
  return json({ error: { code, message, ...extra } }, status);
}

export function domainErrorResponse(err: DomainError): Response {
  return errorResponse(err.code, err.message, {
    ...(err.fields ? { fields: err.fields } : {}),
    ...(err.data ?? {}),
  });
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // 壊れた値（不正な % など）は、その Cookie だけ無視する
    }
  }
  return out;
}

/** HttpOnly、SameSite=Lax、必要なら Secure（NFR3.2） */
export function serializeCookie(
  name: string,
  value: string,
  opts: { secure: boolean; maxAgeSeconds?: number; expires?: Date },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  return parts.join('; ');
}

export function dishJson(d: Dish) {
  return {
    id: d.dishId,
    name: d.name,
    url: d.url,
    cookTime: d.cookTime,
    effort: d.effort,
    moodTags: d.moodTags,
    ingredients: d.ingredients,
    memo: d.memo,
    isFavorite: d.isFavorite,
    source: d.source,
    updatedAt: d.updatedAt,
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
