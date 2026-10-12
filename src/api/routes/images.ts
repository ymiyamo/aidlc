import type { Principal } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { DomainError } from '@/domain/errors';
import {
  ensureImageHandlers,
  getDishImage,
  readDishImageFile,
  registerImage,
  removeImage,
  requestDishImage,
} from '@/domain/images';
import { domainErrorResponse, json } from '../http';

/**
 * U6（画像）の API。
 * 入口（src/api/router.ts）の `routes` に `...imagesRoutes` を足して登録する。
 * 認証・グループの決定・CSRF は入口が行う（ADR-005）。ここでは householdId を画面の入力から受け取らない（BR60.6）。
 * 画像の中身は JSON の { data: base64 } で受け取る（入口が本文を JSON として読むため）
 */
export interface ImagesRouteContext {
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

export interface ImagesRoute {
  method: string;
  pattern: RegExp;
  auth: 'none' | 'user' | 'household';
  /** ログ用の名前（ID や個人情報を含めない） */
  name: string;
  handler: (c: ImagesRouteContext) => Promise<Response>;
}

/** 受け口の登録（household.deleted。BR60.12）は、最初の呼び出しで 1 回だけ行う */
const ctx = (c: ImagesRouteContext): HouseholdContext => {
  ensureImageHandlers(c.deps);
  return c.household!;
};

/** 契約（C1）に合わせ、5MB 超は 413、画像でないものは 415 にする（BR60.1、BR60.2） */
const REJECT_STATUS: Record<string, number> = { IMAGE_TOO_LARGE: 413, IMAGE_NOT_SUPPORTED: 415 };

async function rejectable(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (err) {
    const status = err instanceof DomainError ? REJECT_STATUS[String(err.data?.code)] : undefined;
    if (err instanceof DomainError && status) {
      const res = domainErrorResponse(err);
      return new Response(res.body, { status, headers: res.headers });
    }
    throw err;
  }
}

export const imagesRoutes: ImagesRoute[] = [
  {
    // 料理の画像の状態（BR60.3〜BR60.10）。作成中のときは、画面があとでもう一度取りに来る
    method: 'GET',
    pattern: /^\/api\/dishes\/([^/]+)\/image$/,
    auth: 'household',
    name: 'images.status',
    async handler(c) {
      return json({ image: await getDishImage(c.deps, ctx(c), c.params[0]) });
    },
  },
  {
    // 登録（置き換えを含む。BR60.5）
    method: 'PUT',
    pattern: /^\/api\/dishes\/([^/]+)\/image$/,
    auth: 'household',
    name: 'images.register',
    handler: (c) =>
      rejectable(async () =>
        json({ image: await registerImage(c.deps, ctx(c), c.params[0], c.body) }),
      ),
  },
  {
    // 登録画像を外す（繰り返しても同じ結果。BR60.5）
    method: 'DELETE',
    pattern: /^\/api\/dishes\/([^/]+)\/image$/,
    auth: 'household',
    name: 'images.remove',
    async handler(c) {
      return json({ image: await removeImage(c.deps, ctx(c), c.params[0]) });
    },
  },
  {
    // AI の画像を要求する。すぐ 202 を返し、生成は裏で行う（BR60.7）
    method: 'POST',
    pattern: /^\/api\/dishes\/([^/]+)\/image\/generate$/,
    auth: 'household',
    name: 'images.generate',
    async handler(c) {
      return json({ image: await requestDishImage(c.deps, ctx(c), c.params[0]) }, 202);
    },
  },
  {
    // 画像の実体。取るたびに認証とグループを確認する（BR60.6）
    method: 'GET',
    pattern: /^\/api\/dishes\/([^/]+)\/image\/file$/,
    auth: 'household',
    name: 'images.file',
    async handler(c) {
      const file = await readDishImageFile(c.deps, ctx(c), c.params[0]);
      return new Response(Buffer.from(file.bytes), {
        status: 200,
        headers: {
          'content-type': file.mime,
          'content-length': String(file.bytes.length),
          // 中身を別の種類として扱わせない。共有の置き場に残さない
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, no-store',
        },
      });
    },
  },
];
