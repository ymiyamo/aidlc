import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { setImageServices } from '@/domain/images';
import { createMemoryStorage } from '@/lib/storage';
import { createClient } from '@/test-helpers/client';
import { createTestDeps } from '@/test-helpers/deps';

let deps: AppDeps;
const storage = createMemoryStorage();

beforeAll(async () => {
  ({ deps } = await createTestDeps());
  setImageServices(deps, { storage, sleep: async () => {} });
});
afterAll(async () => {
  await deps.db.close();
});

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngBase64 = () => {
  const b = new Uint8Array(64);
  b.set(PNG_HEAD);
  return Buffer.from(b).toString('base64');
};

const count = async (table: string, dishId: string) =>
  Number(
    (
      await deps.db.query<{ n: string | number }>(
        `select count(*) as n from ${table} where dish_id = $1`,
        [dishId],
      )
    ).rows[0].n,
  );

describe('料理の削除と画像（BR60.12）', () => {
  it('料理を削除すると、登録した画像の実体と記録が消える', async () => {
    const c = createClient(deps);
    expect((await c.signUpWithHousehold('del-img@example.com')).status).toBe(201);
    const created = await c.post('/api/dishes', { name: 'カレー', url: 'https://example.com/c' });
    const dishId = created.body.dish.id as string;
    expect((await c.put(`/api/dishes/${dishId}/image`, { data: pngBase64() })).status).toBe(200);
    expect(storage.size()).toBe(1);
    expect(await count('registered_images', dishId)).toBe(1);

    const del = await c.del(`/api/dishes/${dishId}`);
    expect(del.status).toBe(200);
    expect(await count('registered_images', dishId)).toBe(0);
    expect(await count('generated_images', dishId)).toBe(0);
    expect(storage.size()).toBe(0);
    // 削除済みの料理の画像は取れない
    expect((await c.get(`/api/dishes/${dishId}/image`)).status).toBe(404);
  });

  it('画像の削除が失敗しても、料理の削除は成功する', async () => {
    const c = createClient(deps);
    await c.signUpWithHousehold('del-img2@example.com');
    const created = await c.post('/api/dishes', { name: '肉じゃが', url: 'https://example.com/n' });
    const dishId = created.body.dish.id as string;
    await c.put(`/api/dishes/${dishId}/image`, { data: pngBase64() });

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
      expect((await c.del(`/api/dishes/${dishId}`)).status).toBe(200);
      expect(logged).toContain('image_object_delete_failed');
    } finally {
      deps.logger = original;
      setImageServices(deps, { storage });
    }
  });

  it('他のグループの料理は削除できず、その画像も消えない', async () => {
    const a = createClient(deps);
    await a.signUpWithHousehold('del-img-a@example.com');
    const created = await a.post('/api/dishes', { name: 'A の料理', url: 'https://example.com/a' });
    const dishId = created.body.dish.id as string;
    await a.put(`/api/dishes/${dishId}/image`, { data: pngBase64() });

    const b = createClient(deps);
    await b.signUpWithHousehold('del-img-b@example.com');
    expect((await b.del(`/api/dishes/${dishId}`)).status).toBe(404);
    expect(await count('registered_images', dishId)).toBe(1);
  });
});
