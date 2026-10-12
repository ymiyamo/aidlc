import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { register } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { createDish } from '@/domain/dish';
import { flushImageJobs, setImageServices } from '@/domain/images';
import { createMemoryStorage } from '@/lib/storage';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import { imagesClient } from './images-harness';

let deps: AppDeps;
beforeAll(async () => {
  ({ deps } = await createTestDeps());
  setImageServices(deps, { storage: createMemoryStorage(), sleep: async () => {} });
});
afterAll(async () => {
  await deps.db.close();
});

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size = 64) => {
  const b = new Uint8Array(size);
  b.set(PNG_HEAD);
  return b;
};
const body = (bytes: Uint8Array) => ({ data: Buffer.from(bytes).toString('base64') });

/** ログイン済みでグループもあるクライアントと、料理 1 件 */
async function member(label = 'm') {
  const h = await registerWithHousehold(deps, label);
  const dish = await createDish(deps, h.ctx, {
    name: 'カレー',
    url: `https://example.com/${label}`,
  });
  return { ...h, dish, api: imagesClient(deps, h.session.token) };
}

describe('入口：未ログイン・グループなし・CSRF', () => {
  const id = crypto.randomUUID();
  const calls: [string, string, unknown][] = [
    ['GET', `/api/dishes/${id}/image`, undefined],
    ['PUT', `/api/dishes/${id}/image`, { data: 'AA==' }],
    ['DELETE', `/api/dishes/${id}/image`, undefined],
    ['POST', `/api/dishes/${id}/image/generate`, {}],
    ['GET', `/api/dishes/${id}/image/file`, undefined],
  ];

  it('未ログインは 401', async () => {
    const anon = imagesClient(deps);
    for (const [method, path, b] of calls) {
      expect((await anon.call(method, path, { body: b })).status, `${method} ${path}`).toBe(401);
    }
  });

  it('グループがない人は 403', async () => {
    const s = await register(deps, {
      email: 'loner-img@example.com',
      password: 'password-1234',
      displayName: 'l',
    });
    const loner = imagesClient(deps, s.token);
    for (const [method, path, b] of calls) {
      expect((await loner.call(method, path, { body: b })).status, `${method} ${path}`).toBe(403);
    }
  });

  it('合言葉（CSRF）か Origin がない状態を変える操作は拒否され、画像は変わらない', async () => {
    const m = await member('csrf');
    const path = `/api/dishes/${m.dish.dishId}/image`;
    const b = body(png());
    expect((await m.api.call('PUT', path, { body: b, csrf: false })).status).toBe(403);
    expect((await m.api.call('PUT', path, { body: b, origin: false })).status).toBe(403);
    expect((await m.api.call('DELETE', path, { csrf: false })).status).toBe(403);
    expect((await m.api.call('POST', `${path}/generate`, { body: {}, csrf: false })).status).toBe(
      403,
    );
    expect((await m.api.get(path)).body.image.source).not.toBe('registered');
  });
});

describe('登録・表示・外す', () => {
  it('登録すると registered になり、実体は正しい種類で取れる。印はない', async () => {
    const m = await member('reg');
    const path = `/api/dishes/${m.dish.dishId}/image`;
    const put = await m.api.put(path, body(png(2000)));
    expect(put.status).toBe(200);
    expect(put.body.image).toMatchObject({
      source: 'registered',
      status: 'ready',
      isAiGenerated: false,
    });
    expect(put.body.image.altText).toBe('カレー');

    const file = await m.api.raw(`${path}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(file.bytes.length).toBe(2000);
    // URL の先頭で他の料理の画像は取れない
    const url = put.body.image.url as string;
    expect(url.startsWith(`${path}/file`)).toBe(true);
    // 応答に保管の名前（storageKey）を含めない
    expect(put.text).not.toContain('registered/');
    expect(put.text).not.toContain('storage');
  });

  it('5MB 超は 413、画像でないものは 415。理由を返し、登録済みの画像は変わらない', async () => {
    const m = await member('rej');
    const path = `/api/dishes/${m.dish.dishId}/image`;
    await m.api.put(path, body(png(100)));

    const big = await m.api.put(path, body(png(5 * 1024 * 1024 + 1)));
    expect(big.status).toBe(413);
    expect(big.body.error.fields.image).toContain('5MB を超えています');

    const text = await m.api.put(path, {
      data: Buffer.from('<script>alert(1)</script>').toString('base64'),
    });
    expect(text.status).toBe(415);
    expect(text.body.error.fields.image).toContain('画像ではありません');

    const empty = await m.api.put(path, {});
    expect(empty.status).toBe(415);

    const file = await m.api.raw(`${path}/file`);
    expect(file.bytes.length).toBe(100);
  });

  it('ちょうど 5MB は登録できる', async () => {
    const m = await member('exact');
    const res = await m.api.put(`/api/dishes/${m.dish.dishId}/image`, body(png(5 * 1024 * 1024)));
    expect(res.status).toBe(200);
  });

  it('外すと AI の画像の作成に戻り、しばらくすると「AI が作ったイメージ」の印つきで出る', async () => {
    const m = await member('rm');
    const path = `/api/dishes/${m.dish.dishId}/image`;
    await m.api.put(path, body(png()));
    const del = await m.api.del(path);
    expect(del.status).toBe(200);
    expect(del.body.image).toMatchObject({ source: 'none', status: 'pending', url: null });
    expect((await m.api.del(path)).status).toBe(200); // 繰り返しても同じ
    await flushImageJobs(deps);
    const view = (await m.api.get(path)).body.image;
    expect(view).toMatchObject({ source: 'generated', status: 'ready', isAiGenerated: true });
    expect(view.altText).toContain('AI が作ったイメージ');
    const file = await m.api.raw(`${path}/file`);
    expect(file.headers.get('content-type')).toBe('image/png');
  });

  it('AI の画像の要求は 202 を返し、生成は裏で終わって印つきの画像になる', async () => {
    const m = await member('gen');
    const res = await m.api.post(`/api/dishes/${m.dish.dishId}/image/generate`);
    expect(res.status).toBe(202);
    // ダミーは速いので、応答の時点で作成中か完成のどちらか
    expect(['pending', 'ready']).toContain(res.body.image.status);
    await flushImageJobs(deps);
    const view = (await m.api.get(`/api/dishes/${m.dish.dishId}/image`)).body.image;
    expect(view).toMatchObject({ source: 'generated', status: 'ready', isAiGenerated: true });
  });

  it('初期データの料理は、生成を待たずに印つきの画像が出る', async () => {
    const h = await registerWithHousehold(deps, 'seedapi');
    const api = imagesClient(deps, h.session.token);
    const dishes = await deps.db.query<{ dish_id: string }>(
      `select dish_id from dishes where household_id = $1 and source = 'seed' limit 1`,
      [h.householdId],
    );
    const res = await api.get(`/api/dishes/${dishes.rows[0].dish_id}/image`);
    expect(res.body.image).toMatchObject({
      source: 'generated',
      status: 'ready',
      isAiGenerated: true,
    });
  });
});

describe('グループの範囲（BR60.6）', () => {
  it('他のグループの人は、料理の ID も画像の URL も知っていても、見られず変えられない', async () => {
    const a = await member('grpA');
    const b = await member('grpB');
    const path = `/api/dishes/${a.dish.dishId}/image`;
    const put = await a.api.put(path, body(png(300)));
    const url = put.body.image.url as string;

    for (const [method, p] of [
      ['GET', path],
      ['GET', url],
      ['DELETE', path],
      ['POST', `${path}/generate`],
    ] as const) {
      const res = await b.api.call(method, p, { body: method === 'POST' ? {} : undefined });
      expect(res.status, `${method} ${p}`).toBe(404);
    }
    expect((await b.api.put(path, body(png(10)))).status).toBe(404);
    const raw = await b.api.raw(url);
    expect(raw.status).toBe(404);
    expect(raw.bytes.length).toBeLessThan(200); // 画像の中身は返らない

    // A の画像はそのまま
    const still = await a.api.raw(`${path}/file`);
    expect(still.bytes.length).toBe(300);
  });

  it('存在しない料理・形の違う ID は 404', async () => {
    const m = await member('nf');
    expect((await m.api.get(`/api/dishes/${crypto.randomUUID()}/image`)).status).toBe(404);
    expect((await m.api.get('/api/dishes/not-a-uuid/image')).status).toBe(404);
    expect((await m.api.raw(`/api/dishes/${crypto.randomUUID()}/image/file`)).status).toBe(404);
  });

  it('画像の実体が無い料理（作成中・失敗）の実体取得は 404', async () => {
    const m = await member('nofile');
    const path = `/api/dishes/${m.dish.dishId}/image`;
    expect((await m.api.raw(`${path}/file`)).status).toBe(404);
  });
});
