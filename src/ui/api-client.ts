import type { DeckApi, NextResult } from './SuggestionDeck';
import type { DishDto } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;

async function getCsrf(): Promise<string> {
  if (!csrfToken) {
    const res = await fetch('/api/csrf', { credentials: 'same-origin' });
    csrfToken = ((await res.json()) as { token: string }).token;
  }
  return csrfToken;
}

/** 画面から API を呼ぶ。状態を変える操作には合言葉（CSRF）を付ける */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = {};
    if (method !== 'GET') headers['x-csrf-token'] = await getCsrf();
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { code: string; message: string; fields?: Record<string, string> } & Record<
        string,
        unknown
      >;
    };
    if (res.ok) return data as T;
    const e = data.error;
    if (e?.code === 'csrf' && attempt === 0) {
      csrfToken = null; // 合言葉を取り直して 1 回だけやり直す
      continue;
    }
    const { code, message, fields, ...rest } = e ?? {
      code: 'unknown',
      message: 'エラーが発生しました',
    };
    throw new ApiError(res.status, code, message, fields ?? {}, rest);
  }
  throw new ApiError(0, 'unknown', 'エラーが発生しました');
}

/** 買い物前の画面が使う API（テストでは差し替える） */
export const deckApi: DeckApi = {
  async next(seen: string[]): Promise<NextResult> {
    const q = seen.length ? `?seen=${seen.join(',')}` : '';
    return api<NextResult>('GET', `/api/suggestions/next${q}`);
  },
  async pick(dishId: string) {
    await api('POST', '/api/picked', { dishId });
  },
  async setFavorite(dishId: string, isFavorite: boolean): Promise<DishDto> {
    return (await api<{ dish: DishDto }>('PUT', `/api/dishes/${dishId}/favorite`, { isFavorite }))
      .dish;
  },
};
