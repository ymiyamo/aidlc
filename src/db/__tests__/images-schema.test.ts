import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import { createTestDb } from '@/test-helpers/db';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const id = () => crypto.randomUUID();

/** グループ・メンバー・料理 1 件を直接作る */
async function setup() {
  const householdId = id();
  const memberId = id();
  const dishId = id();
  await db.query('insert into households (household_id, name) values ($1,$2)', [householdId, 'g']);
  await db.query('insert into members (member_id, household_id) values ($1,$2)', [
    memberId,
    householdId,
  ]);
  await db.query('insert into dishes (dish_id, household_id, name, url) values ($1,$2,$3,$4)', [
    dishId,
    householdId,
    'A',
    'https://example.com/x',
  ]);
  return { householdId, memberId, dishId };
}

const insertRegistered = (
  s: { householdId: string; dishId: string },
  over: { contentType?: string; byteSize?: number; dishId?: string } = {},
) =>
  db.query(
    `insert into registered_images (image_id, household_id, dish_id, content_type, byte_size, storage_key)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      id(),
      s.householdId,
      over.dishId ?? s.dishId,
      over.contentType ?? 'png',
      over.byteSize ?? 100,
      `registered/${'a'.repeat(48)}`,
    ],
  );

const insertGenerated = (
  s: { householdId: string; dishId: string },
  v: { status?: string; attempt?: number; key?: string | null; type?: string | null } = {},
) =>
  db.query(
    `insert into generated_images (generated_image_id, household_id, dish_id, status, attempt_count,
                                   storage_key, content_type, requested_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())`,
    [
      id(),
      s.householdId,
      s.dishId,
      v.status ?? 'pending',
      v.attempt ?? 0,
      v.key ?? null,
      v.type ?? null,
    ],
  );

describe('registered_images の制約', () => {
  it('同じ料理に登録画像は 1 件まで（置き換えは上書きで行う）', async () => {
    const s = await setup();
    await insertRegistered(s);
    await expect(insertRegistered(s)).rejects.toMatchObject({ code: '23505' });
  });

  it('大きさは 1 バイト以上 5MB 以下。ちょうど 5MB は入り、超えると拒否される', async () => {
    const s = await setup();
    await expect(insertRegistered(s, { byteSize: 0 })).rejects.toThrow();
    await expect(insertRegistered(s, { byteSize: 5 * 1024 * 1024 + 1 })).rejects.toThrow();
    await insertRegistered(s, { byteSize: 5 * 1024 * 1024 });
  });

  it('形式は jpeg・png・webp・gif だけ', async () => {
    const s = await setup();
    await expect(insertRegistered(s, { contentType: 'svg' })).rejects.toThrow();
    await expect(insertRegistered(s, { contentType: 'pdf' })).rejects.toThrow();
  });

  it('存在しない料理は参照できない', async () => {
    const s = await setup();
    await expect(insertRegistered(s, { dishId: id() })).rejects.toMatchObject({ code: '23503' });
  });
});

describe('generated_images の制約', () => {
  it('同じ料理に生成画像は 1 件まで', async () => {
    const s = await setup();
    await insertGenerated(s);
    await expect(insertGenerated(s)).rejects.toMatchObject({ code: '23505' });
  });

  it('状態は pending・ready・failed だけ', async () => {
    const s = await setup();
    await expect(insertGenerated(s, { status: 'done' })).rejects.toThrow();
  });

  it('ready のときだけ、保管の名前と形式を持つ', async () => {
    const s = await setup();
    await expect(insertGenerated(s, { status: 'ready' })).rejects.toThrow();
    await expect(
      insertGenerated(s, { status: 'pending', key: 'generated/x', type: 'png' }),
    ).rejects.toThrow();
    await expect(insertGenerated(s, { status: 'failed', key: 'generated/x' })).rejects.toThrow();
    await insertGenerated(s, { status: 'ready', key: 'generated/x', type: 'png' });
  });

  it('試行の回数は 0〜4', async () => {
    const s = await setup();
    await expect(insertGenerated(s, { attempt: 5 })).rejects.toThrow();
    await expect(insertGenerated(s, { attempt: -1 })).rejects.toThrow();
    await insertGenerated(s, { attempt: 4 });
  });
});
