import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { createDish } from '@/domain/dish';
import { createDiskStorage, createMemoryStorage, newStorageKey } from '@/lib/storage';
import { listDishes } from '@/repo/dishes';
import { getGenerated, getRegistered, insertGeneratedPending } from '@/repo/images';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import {
  MAX_IMAGE_BYTES,
  deleteImagesForDish,
  detectImageType,
  ensureImageHandlers,
  flushImageJobs,
  getDishImage,
  readDishImageFile,
  registerImage,
  removeImage,
  requestDishImage,
  setImageServices,
  type ImageGeneratorPort,
  type SeedImageSource,
} from '../index';
import { renderDummyPng } from '../dummy';

let deps: AppDeps;
let clock: TestClock;
const storage = createMemoryStorage();
beforeAll(async () => {
  ({ deps, clock } = await createTestDeps());
  setImageServices(deps, { storage, sleep: async () => {}, config: { retryDelayMs: 0 } });
});
afterAll(async () => {
  await deps.db.close();
});

/** 先頭が形式の印で、残りは 0 のダミーの画像（形式の判定は先頭バイトだけで行うため） */
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const fake = (head: number[], size: number) => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const pngBody = (size = 100) => ({ data: b64(fake(PNG_HEAD, size)) });

async function world(label: string) {
  const u = await registerWithHousehold(deps, label);
  const dish = await createDish(deps, u.ctx, {
    name: `${label}の料理`,
    url: `https://example.com/${label}`,
  });
  return { ...u, dish };
}

const messageOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as { code: string; fields?: Record<string, string>; data?: { code?: string } };
  }
  throw new Error('rejected されませんでした');
};

describe('画像の種類の判定（BR60.1）', () => {
  it('JPEG・PNG・GIF・WebP を中身の先頭バイトで判定する', () => {
    expect(detectImageType(fake([0xff, 0xd8, 0xff], 10))).toBe('jpeg');
    expect(detectImageType(fake(PNG_HEAD, 20))).toBe('png');
    expect(detectImageType(new TextEncoder().encode('GIF89a......'))).toBe('gif');
    expect(detectImageType(new TextEncoder().encode('GIF87a......'))).toBe('gif');
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(detectImageType(webp)).toBe('webp');
  });

  it('画像でない中身は null（空、文字、HTML、SVG、RIFF だが WebP でないもの）', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(detectImageType(new Uint8Array(0))).toBeNull();
    expect(detectImageType(enc('hello world'))).toBeNull();
    expect(detectImageType(enc('<html></html>'))).toBeNull();
    expect(detectImageType(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(enc('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
  });
});

describe('登録（BR60.1、BR60.2、BR60.5）', () => {
  it('5MB ちょうどは登録でき、1 バイト超えると拒否される。拒否しても登録済みの画像は変わらない', async () => {
    const w = await world('size');
    const ok = await registerImage(deps, w.ctx, w.dish.dishId, pngBody(MAX_IMAGE_BYTES));
    expect(ok).toMatchObject({ source: 'registered', status: 'ready', isAiGenerated: false });
    const before = await getRegistered(deps.db, w.householdId, w.dish.dishId);
    expect(before?.byteSize).toBe(MAX_IMAGE_BYTES);

    const err = await messageOf(
      registerImage(deps, w.ctx, w.dish.dishId, pngBody(MAX_IMAGE_BYTES + 1)),
    );
    expect(err.code).toBe('validation');
    expect(err.data?.code).toBe('IMAGE_TOO_LARGE');
    expect(err.fields?.image).toContain('5MB を超えています');
    const after = await getRegistered(deps.db, w.householdId, w.dish.dishId);
    expect(after?.imageId).toBe(before?.imageId);
  });

  it('拡張子だけ画像のファイル（中身が文字）・空・data なしは拒否される', async () => {
    const w = await world('notimg');
    const text = { data: Buffer.from('これは画像ではありません.png').toString('base64') };
    for (const body of [text, { data: '' }, {}, { data: 123 }, null]) {
      const err = await messageOf(registerImage(deps, w.ctx, w.dish.dishId, body));
      expect(err.data?.code).toBe('IMAGE_NOT_SUPPORTED');
      expect(err.fields?.image).toContain('画像ではありません');
    }
    expect(await getRegistered(deps.db, w.householdId, w.dish.dishId)).toBeNull();
  });

  it('大きさは申告ではなく受け取った中身で数える（大きな偽物は復元せずに断る）', async () => {
    const w = await world('big');
    const err = await messageOf(
      registerImage(deps, w.ctx, w.dish.dishId, { data: 'A'.repeat(8 * 1024 * 1024) }),
    );
    expect(err.data?.code).toBe('IMAGE_TOO_LARGE');
  });

  it('再登録は置き換え。古い実体は消え、1 料理に 1 枚のまま', async () => {
    const w = await world('replace');
    await registerImage(deps, w.ctx, w.dish.dishId, pngBody(50));
    const first = await getRegistered(deps.db, w.householdId, w.dish.dishId);
    expect(await storage.get(first!.storageKey)).not.toBeNull();
    await registerImage(deps, w.ctx, w.dish.dishId, pngBody(60));
    const second = await getRegistered(deps.db, w.householdId, w.dish.dishId);
    expect(second?.byteSize).toBe(60);
    expect(second?.storageKey).not.toBe(first?.storageKey);
    expect(await storage.get(first!.storageKey)).toBeNull();
    expect(await storage.get(second!.storageKey)).not.toBeNull();
  });

  it('他のグループの料理・削除済みの料理・形の違う ID は「見つからない」', async () => {
    const a = await world('ownA');
    const b = await world('ownB');
    for (const dishId of [a.dish.dishId, 'not-a-uuid', crypto.randomUUID()]) {
      expect((await messageOf(registerImage(deps, b.ctx, dishId, pngBody()))).code).toBe(
        'not_found',
      );
    }
    expect(await getRegistered(deps.db, a.householdId, a.dish.dishId)).toBeNull();
    expect((await messageOf(getDishImage(deps, b.ctx, a.dish.dishId))).code).toBe('not_found');
    expect((await messageOf(removeImage(deps, b.ctx, a.dish.dishId))).code).toBe('not_found');
    expect((await messageOf(readDishImageFile(deps, b.ctx, a.dish.dishId))).code).toBe('not_found');
  });

  it('外すと生成画像（AI の画像）の表示に戻る。繰り返し外しても同じ結果', async () => {
    const w = await world('remove');
    await registerImage(deps, w.ctx, w.dish.dishId, pngBody());
    const key = (await getRegistered(deps.db, w.householdId, w.dish.dishId))!.storageKey;
    const view = await removeImage(deps, w.ctx, w.dish.dishId);
    expect(view.source).toBe('none');
    expect(view.status).toBe('pending');
    expect(await storage.get(key)).toBeNull();
    await expect(removeImage(deps, w.ctx, w.dish.dishId)).resolves.toBeDefined();
    await flushImageJobs(deps);
    expect(await getDishImage(deps, w.ctx, w.dish.dishId)).toMatchObject({
      source: 'generated',
      isAiGenerated: true,
    });
  });
});

describe('表示の決まり（BR60.3、BR60.4、BR60.8、BR60.10、BR60.14）', () => {
  it('登録も生成もないとき、作成中（色の枠）を返し、裏で生成して「AI が作ったイメージ」の印つきになる', async () => {
    const w = await world('view1');
    const first = await getDishImage(deps, w.ctx, w.dish.dishId);
    expect(first).toEqual({
      source: 'none',
      status: 'pending',
      url: null,
      isAiGenerated: false,
      altText: 'view1の料理',
    });
    await flushImageJobs(deps);
    const second = await getDishImage(deps, w.ctx, w.dish.dishId);
    expect(second).toMatchObject({
      source: 'generated',
      status: 'ready',
      isAiGenerated: true,
      altText: 'view1の料理のイメージ（AI が作ったイメージ）',
    });
    expect(second.url).toContain(`/api/dishes/${w.dish.dishId}/image/file`);
    // 実体はダミーの PNG
    const file = await readDishImageFile(deps, w.ctx, w.dish.dishId);
    expect(file).toMatchObject({ contentType: 'png', mime: 'image/png' });
    expect(detectImageType(file.bytes)).toBe('png');
  });

  it('登録画像があれば、AI の画像は出ず、印もない。生成も要求しない', async () => {
    const w = await world('view2');
    await registerImage(deps, w.ctx, w.dish.dishId, pngBody());
    const view = await getDishImage(deps, w.ctx, w.dish.dishId);
    expect(view).toMatchObject({ source: 'registered', isAiGenerated: false, status: 'ready' });
    expect(view.altText).toBe('view2の料理');
    await flushImageJobs(deps);
    expect(await getGenerated(deps.db, w.householdId, w.dish.dishId)).toBeNull();
    expect((await requestDishImage(deps, w.ctx, w.dish.dishId)).source).toBe('registered');
    expect(await getGenerated(deps.db, w.householdId, w.dish.dishId)).toBeNull();
  });

  it('同じ料理への要求が重なっても、生成は 1 回だけ（冪等）', async () => {
    const w = await world('view3');
    let calls = 0;
    const counting: ImageGeneratorPort = {
      async generate() {
        calls += 1;
        return { bytes: renderDummyPng('x'), contentType: 'png' };
      },
    };
    setImageServices(deps, { generator: counting });
    try {
      await Promise.all([
        getDishImage(deps, w.ctx, w.dish.dishId),
        getDishImage(deps, w.ctx, w.dish.dishId),
        requestDishImage(deps, w.ctx, w.dish.dishId),
      ]);
      await flushImageJobs(deps);
      await getDishImage(deps, w.ctx, w.dish.dishId);
      await requestDishImage(deps, w.ctx, w.dish.dishId);
      await flushImageJobs(deps);
      expect(calls).toBe(1);
    } finally {
      setImageServices(deps, { generator: undefined });
    }
  });

  it('初期データの料理は素材を生成画像として見せ、生成を要求しない（BR60.9）', async () => {
    const w = await registerWithHousehold(deps, 'seedview');
    const seed = (await listDishes(deps.db, w.householdId)).find((d) => d.source === 'seed')!;
    const ctx = w.ctx;
    const view = await getDishImage(deps, ctx, seed.dishId);
    expect(view).toMatchObject({ source: 'generated', status: 'ready', isAiGenerated: true });
    expect(await getGenerated(deps.db, w.householdId, seed.dishId)).toBeNull();
    const file = await readDishImageFile(deps, ctx, seed.dishId);
    expect(detectImageType(file.bytes)).toBe('png');
    // 利用者が登録画像を付ければ、そちらを優先する
    await registerImage(deps, ctx, seed.dishId, pngBody());
    expect((await getDishImage(deps, ctx, seed.dishId)).source).toBe('registered');
  });

  it('初期データの素材が使えないとき、その料理だけ色の枠（failed）にして記録する', async () => {
    const logged: string[] = [];
    const broken: SeedImageSource = { get: async () => null };
    const w = await registerWithHousehold(deps, 'seedbad');
    const dishes = await listDishes(deps.db, w.householdId);
    const seedDish = dishes.find((d) => d.source === 'seed')!;
    const userDish = await createDish(deps, w.ctx, {
      name: '自分の料理',
      url: 'https://example.com/own',
    });
    const original = deps.logger;
    deps.logger = { ...original, error: (m) => void logged.push(m) };
    setImageServices(deps, { seeds: broken });
    try {
      expect(await getDishImage(deps, w.ctx, seedDish.dishId)).toMatchObject({
        source: 'none',
        status: 'failed',
        isAiGenerated: false,
      });
      expect(logged).toContain('seed_image_invalid');
      // ほかの料理は止まらない
      expect((await getDishImage(deps, w.ctx, userDish.dishId)).status).toBe('pending');
      await flushImageJobs(deps);
    } finally {
      deps.logger = original;
      setImageServices(deps, { seeds: undefined });
    }
  });
});

describe('生成の失敗と期限（BR60.7、BR60.11）', () => {
  it('2 回失敗しても再試行で成功すれば ready。試行は数えられる', async () => {
    const w = await world('retry');
    let n = 0;
    setImageServices(deps, {
      generator: {
        async generate() {
          n += 1;
          if (n <= 2) throw new Error('boom');
          return { bytes: renderDummyPng('x'), contentType: 'png' };
        },
      },
    });
    try {
      await getDishImage(deps, w.ctx, w.dish.dishId);
      await flushImageJobs(deps);
      const g = await getGenerated(deps.db, w.householdId, w.dish.dishId);
      expect(g).toMatchObject({ status: 'ready', attemptCount: 3 });
    } finally {
      setImageServices(deps, { generator: undefined });
    }
  });

  it('最初の 1 回 + 再試行 3 回で失敗が続けば failed。画面は色の枠のまま、印は出ない', async () => {
    const w = await world('fail');
    let n = 0;
    setImageServices(deps, {
      generator: {
        async generate() {
          n += 1;
          throw new Error('boom');
        },
      },
    });
    try {
      await getDishImage(deps, w.ctx, w.dish.dishId);
      await flushImageJobs(deps);
      expect(n).toBe(4);
      expect(await getGenerated(deps.db, w.householdId, w.dish.dishId)).toMatchObject({
        status: 'failed',
        attemptCount: 4,
      });
      // 取得では勝手にやり直さない（費用を使い続けない）
      expect(await getDishImage(deps, w.ctx, w.dish.dishId)).toMatchObject({
        source: 'none',
        status: 'failed',
        isAiGenerated: false,
      });
      await flushImageJobs(deps);
      expect(n).toBe(4);
    } finally {
      setImageServices(deps, { generator: undefined });
    }
  });

  it('利用者が AI の画像を再要求すると、failed からやり直せる', async () => {
    const w = await world('rerequest');
    let broken = true;
    setImageServices(deps, {
      generator: {
        async generate() {
          if (broken) throw new Error('boom');
          return { bytes: renderDummyPng('x'), contentType: 'png' };
        },
      },
    });
    try {
      await getDishImage(deps, w.ctx, w.dish.dishId);
      await flushImageJobs(deps);
      expect((await getDishImage(deps, w.ctx, w.dish.dishId)).status).toBe('failed');
      broken = false;
      await requestDishImage(deps, w.ctx, w.dish.dishId);
      await flushImageJobs(deps);
      expect((await getDishImage(deps, w.ctx, w.dish.dishId)).status).toBe('ready');
    } finally {
      setImageServices(deps, { generator: undefined });
    }
  });

  it('待つ上限を超えた生成は失敗として数える', async () => {
    const w = await world('timeout');
    setImageServices(deps, {
      generator: { generate: () => new Promise<never>(() => {}) },
      config: { maxAttempts: 2, timeoutMs: 5, retryDelayMs: 0 },
    });
    try {
      await getDishImage(deps, w.ctx, w.dish.dishId);
      await flushImageJobs(deps);
      expect(await getGenerated(deps.db, w.householdId, w.dish.dishId)).toMatchObject({
        status: 'failed',
        attemptCount: 2,
      });
    } finally {
      setImageServices(deps, { generator: undefined, config: undefined });
    }
  });

  it('生成した中身が画像でないときも失敗として扱い、実体を残さない', async () => {
    const w = await world('badgen');
    const before = storage.size();
    setImageServices(deps, {
      generator: {
        generate: async () => ({ bytes: new TextEncoder().encode('text'), contentType: 'png' }),
      },
    });
    try {
      await getDishImage(deps, w.ctx, w.dish.dishId);
      await flushImageJobs(deps);
      expect((await getGenerated(deps.db, w.householdId, w.dish.dishId))?.status).toBe('failed');
      expect(storage.size()).toBe(before);
    } finally {
      setImageServices(deps, { generator: undefined });
    }
  });

  it('グループの生成画像の数が上限を超えたら、生成せず failed にする', async () => {
    const w = await world('limit');
    let calls = 0;
    setImageServices(deps, {
      generator: {
        generate: async () => {
          calls += 1;
          return { bytes: renderDummyPng('x'), contentType: 'png' };
        },
      },
      config: { maxGeneratedPerHousehold: 0, retryDelayMs: 0 },
    });
    try {
      await getDishImage(deps, w.ctx, w.dish.dishId);
      await flushImageJobs(deps);
      expect(calls).toBe(0);
      expect((await getGenerated(deps.db, w.householdId, w.dish.dishId))?.status).toBe('failed');
    } finally {
      setImageServices(deps, { generator: undefined, config: undefined });
    }
  });

  it('pending は 10 分で期限切れになり、次の取得で再要求される（9 分 59 秒では変わらない）', async () => {
    const w = await world('ttl');
    // 裏の処理が止まったときの状態を、直接作る
    await insertGeneratedPending(deps.db, w.householdId, {
      generatedImageId: crypto.randomUUID(),
      dishId: w.dish.dishId,
      now: deps.now(),
    });
    let calls = 0;
    setImageServices(deps, {
      generator: {
        generate: async () => {
          calls += 1;
          return { bytes: renderDummyPng('x'), contentType: 'png' };
        },
      },
    });
    try {
      clock.advanceMs(10 * 60 * 1000 - 1000);
      expect((await getDishImage(deps, w.ctx, w.dish.dishId)).status).toBe('pending');
      await flushImageJobs(deps);
      expect(calls).toBe(0);

      clock.advanceMs(1000);
      expect((await getDishImage(deps, w.ctx, w.dish.dishId)).status).toBe('pending');
      await flushImageJobs(deps);
      expect(calls).toBe(1);
      expect((await getDishImage(deps, w.ctx, w.dish.dishId)).status).toBe('ready');
    } finally {
      setImageServices(deps, { generator: undefined });
    }
  });
});

describe('削除の連動（BR60.12）', () => {
  it('料理の画像を、記録も実体もまとめて消す。繰り返しても同じ', async () => {
    const w = await world('delete');
    await registerImage(deps, w.ctx, w.dish.dishId, pngBody());
    await getDishImage(deps, w.ctx, w.dish.dishId);
    await flushImageJobs(deps);
    const key = (await getRegistered(deps.db, w.householdId, w.dish.dishId))!.storageKey;
    const gkey = await getGenerated(deps.db, w.householdId, w.dish.dishId);
    expect(gkey).toBeNull(); // 登録画像があるので生成していない
    await deleteImagesForDish(deps, w.householdId, w.dish.dishId);
    await deleteImagesForDish(deps, w.householdId, w.dish.dishId);
    expect(await getRegistered(deps.db, w.householdId, w.dish.dishId)).toBeNull();
    expect(await storage.get(key)).toBeNull();
  });

  it('household.deleted を受けると、そのグループの画像だけを消す。何度受けても同じ', async () => {
    const a = await world('hhA');
    const b = await world('hhB');
    await registerImage(deps, a.ctx, a.dish.dishId, pngBody());
    await registerImage(deps, b.ctx, b.dish.dishId, pngBody());
    const keyA = (await getRegistered(deps.db, a.householdId, a.dish.dishId))!.storageKey;
    ensureImageHandlers(deps);
    ensureImageHandlers(deps);
    const event = { eventId: crypto.randomUUID(), householdId: a.householdId };
    await deps.events.publish('household.deleted', event);
    await deps.events.publish('household.deleted', event);
    expect(await getRegistered(deps.db, a.householdId, a.dish.dishId)).toBeNull();
    expect(await storage.get(keyA)).toBeNull();
    expect(await getRegistered(deps.db, b.householdId, b.dish.dishId)).not.toBeNull();
  });

  it('実体の削除に失敗しても、記録は消え、失敗は記録される', async () => {
    const w = await world('delfail');
    await registerImage(deps, w.ctx, w.dish.dishId, pngBody());
    const logged: string[] = [];
    const original = deps.logger;
    deps.logger = { ...original, error: (m) => void logged.push(m) };
    const failing = {
      ...storage,
      delete: async () => {
        throw new Error('io');
      },
    };
    setImageServices(deps, { storage: failing });
    try {
      await deleteImagesForDish(deps, w.householdId, w.dish.dishId);
      expect(await getRegistered(deps.db, w.householdId, w.dish.dishId)).toBeNull();
      expect(logged).toContain('image_object_delete_failed');
    } finally {
      deps.logger = original;
      setImageServices(deps, { storage });
    }
  });
});

describe('ディスクの保管（既定の実装）', () => {
  it('書いて読めて消せる。決まった形でない名前（..、絶対パス）は拒否する', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mp-img-'));
    try {
      const disk = createDiskStorage(dir);
      const key = newStorageKey('registered');
      expect(await disk.get(key)).toBeNull();
      await disk.put(key, new Uint8Array([9, 8, 7]));
      expect(Array.from((await disk.get(key))!)).toEqual([9, 8, 7]);
      await disk.delete(key);
      await disk.delete(key);
      expect(await disk.get(key)).toBeNull();
      for (const bad of ['../x', '/etc/passwd', 'registered/../../x', 'registered/abc']) {
        await expect(disk.put(bad, new Uint8Array([1]))).rejects.toThrow('invalid_storage_key');
        await expect(disk.get(bad)).rejects.toThrow('invalid_storage_key');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
