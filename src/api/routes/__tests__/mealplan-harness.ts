import { handle } from '@/api/router';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@/api/http';
import type { AppDeps } from '@/domain/deps';

const ORIGIN = 'http://localhost';
const CSRF = 'test-csrf-token';

/** 実際の API 入口を通す、献立テスト用のブラウザクライアント。 */
export type MealPlanBody = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface MealPlanClient {
  call(
    method: string,
    path: string,
    opts?: { body?: unknown; csrf?: boolean; origin?: boolean },
  ): Promise<{ status: number; body: MealPlanBody; text: string }>;
  get(path: string): ReturnType<MealPlanClient['call']>;
  post(path: string, body?: unknown): ReturnType<MealPlanClient['call']>;
  put(path: string, body?: unknown): ReturnType<MealPlanClient['call']>;
}

/** sessionToken を持つ（または未ログインの）、ブラウザの代わり */
export function mealPlanClient(deps: AppDeps, sessionToken: string | null = null): MealPlanClient {
  const call: MealPlanClient['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = {
      cookie: [`${CSRF_COOKIE}=${CSRF}`, sessionToken ? `${SESSION_COOKIE}=${sessionToken}` : '']
        .filter(Boolean)
        .join('; '),
    };
    if (opts.csrf !== false) headers[CSRF_HEADER] = CSRF;
    if (opts.origin !== false) headers.origin = ORIGIN;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
      deps,
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  };
  return {
    call,
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, { body: body ?? {} }),
    put: (path, body) => call('PUT', path, { body: body ?? {} }),
  };
}
