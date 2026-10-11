import { handle } from '@/api/router';
import type { AppDeps } from '@/domain/deps';

const ORIGIN = 'http://localhost';

/** Cookie を覚える、API 呼び出し用の簡易クライアント（ブラウザの代わり） */
export function createClient(deps: AppDeps) {
  const jar = new Map<string, string>();
  let csrf: string | null = null;

  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const store = (res: Response) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = decodeURIComponent(pair.slice(i + 1));
      if (value === '' || /Max-Age=0/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
  };

  async function raw(
    method: string,
    path: string,
    opts: {
      body?: unknown;
      headers?: Record<string, string>;
      origin?: string | null;
      csrf?: boolean;
    } = {},
  ) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (opts.csrf !== false && csrf) headers['x-csrf-token'] = csrf;
    const c = cookieHeader();
    if (c) headers.cookie = c;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
      deps,
    );
    store(res);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers, text };
  }

  async function init() {
    const r = await raw('GET', '/api/csrf');
    csrf = r.body.token;
    return r;
  }

  return {
    raw,
    init,
    jar,
    get: (path: string) => raw('GET', path),
    post: (path: string, body?: unknown) => raw('POST', path, { body: body ?? {} }),
    put: (path: string, body?: unknown) => raw('PUT', path, { body: body ?? {} }),
    del: (path: string) => raw('DELETE', path),
    /** 登録 → グループ作成まで */
    async signUp(email: string, password = 'password-1234', displayName = 'テスト') {
      if (!csrf) await init();
      const r = await raw('POST', '/api/auth/register', { body: { email, password, displayName } });
      return r;
    },
    async signUpWithHousehold(email: string) {
      await this.signUp(email);
      return raw('POST', '/api/household', { body: { name: 'テスト家' } });
    },
  };
}
export type TestClient = ReturnType<typeof createClient>;
