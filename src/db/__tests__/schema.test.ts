import { randomUUID } from 'node:crypto';
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

async function addAccount(email: string) {
  const id = randomUUID();
  const r = await db.query(
    'insert into accounts (account_id, email, password_digest) values ($1, $2, $3) on conflict do nothing',
    [id, email, 'digest'],
  );
  return { id, inserted: r.rowCount };
}

async function addHousehold() {
  const id = randomUUID();
  await db.query('insert into households (household_id, name) values ($1, $2)', [id, 'わが家']);
  return id;
}

async function addMember(householdId: string, accountId: string | null) {
  const id = randomUUID();
  const r = await db.query(
    'insert into members (member_id, household_id, account_id) values ($1, $2, $3) on conflict do nothing',
    [id, householdId, accountId],
  );
  return { id, inserted: r.rowCount };
}

async function addDish(householdId: string, extra: { url?: string; seedKey?: string } = {}) {
  const id = randomUUID();
  await db.query(
    `insert into dishes (dish_id, household_id, name, url, source, seed_key)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      householdId,
      '料理',
      extra.url ?? 'https://example.com/a',
      extra.seedKey ? 'seed' : 'user',
      extra.seedKey ?? null,
    ],
  );
  return id;
}

describe('メールアドレスの一意（BR1.2、NFR7.4）', () => {
  it('大文字小文字を無視して重複を拒否する', async () => {
    const a = await addAccount('Taro@Example.com');
    const b = await addAccount('taro@example.com');
    expect(a.inserted).toBe(1);
    expect(b.inserted).toBe(0);
  });

  it('同時に同じメールアドレスで登録しても 1 件だけ', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => addAccount('race@example.com')),
    );
    expect(results.reduce((n, r) => n + r.inserted, 0)).toBe(1);
    const rows = await db.query("select 1 from accounts where lower(email) = 'race@example.com'");
    expect(rows.rowCount).toBe(1);
  });
});

describe('1 人 1 グループ（BR2.1、NFR7.5）', () => {
  it('有効な Member は 1 アカウントにつき 1 件まで', async () => {
    const acc = await addAccount('member1@example.com');
    const h1 = await addHousehold();
    const h2 = await addHousehold();
    expect((await addMember(h1, acc.id)).inserted).toBe(1);
    expect((await addMember(h2, acc.id)).inserted).toBe(0);
  });

  it('同時に 2 つのグループに入ろうとしても 1 件だけ', async () => {
    const acc = await addAccount('member2@example.com');
    const hs = await Promise.all([addHousehold(), addHousehold(), addHousehold()]);
    const results = await Promise.all(hs.map((h) => addMember(h, acc.id)));
    expect(results.reduce((n, r) => n + r.inserted, 0)).toBe(1);
  });

  it('退会済み（left_at あり）の Member は数に入らない', async () => {
    const acc = await addAccount('member3@example.com');
    const h1 = await addHousehold();
    const h2 = await addHousehold();
    const first = await addMember(h1, acc.id);
    await db.query('update members set left_at = now() where member_id = $1', [first.id]);
    expect((await addMember(h2, acc.id)).inserted).toBe(1);
  });
});

describe('選んだもの（BR4.7、NFR7.6）', () => {
  it('同じ（グループ、料理）の PickedItem は 1 件まで。同時でも 1 件', async () => {
    const acc = await addAccount('picker@example.com');
    const h = await addHousehold();
    const m = await addMember(h, acc.id);
    const d = await addDish(h);
    const pick = () =>
      db.query(
        'insert into picked_items (picked_id, household_id, dish_id, member_id) values ($1, $2, $3, $4) on conflict do nothing',
        [randomUUID(), h, d, m.id],
      );
    const results = await Promise.all([pick(), pick(), pick()]);
    expect(results.reduce((n, r) => n + r.rowCount, 0)).toBe(1);
  });
});

describe('初期データの一意（BR3.12、NFR7.7）', () => {
  it('（グループ、seedKey）は削除済みも含めて 1 件', async () => {
    const h = await addHousehold();
    const id = await addDish(h, { seedKey: 'k1' });
    await db.query('update dishes set deleted_at = now() where dish_id = $1', [id]);
    await expect(addDish(h, { seedKey: 'k1' })).rejects.toThrow();
  });

  it('別のグループなら同じ seedKey を持てる', async () => {
    const h1 = await addHousehold();
    const h2 = await addHousehold();
    await addDish(h1, { seedKey: 'same' });
    await expect(addDish(h2, { seedKey: 'same' })).resolves.toBeTruthy();
  });
});

describe('料理の制約と論理削除の列', () => {
  it('URL が http/https 以外なら保存できない（BR3.1）', async () => {
    const h = await addHousehold();
    await expect(addDish(h, { url: 'javascript:alert(1)' })).rejects.toThrow();
    await expect(addDish(h, { url: 'ftp://example.com/x' })).rejects.toThrow();
  });

  it('同じグループに同じ URL の料理が複数あってよい（BR3.7）', async () => {
    const h = await addHousehold();
    await addDish(h, { url: 'https://example.com/dup' });
    await expect(addDish(h, { url: 'https://example.com/dup' })).resolves.toBeTruthy();
  });

  it('deleted_at は空で始まり、設定できる（論理削除）', async () => {
    const h = await addHousehold();
    const id = await addDish(h);
    const before = await db.query<{ deleted_at: Date | null }>(
      'select deleted_at from dishes where dish_id = $1',
      [id],
    );
    expect(before.rows[0].deleted_at).toBeNull();
    await db.query('update dishes set deleted_at = now() where dish_id = $1', [id]);
    const after = await db.query<{ deleted_at: Date | null }>(
      'select deleted_at from dishes where dish_id = $1',
      [id],
    );
    expect(after.rows[0].deleted_at).not.toBeNull();
  });

  it('気分タグは 5 個まで', async () => {
    const h = await addHousehold();
    const insert = (tags: string[]) =>
      db.query(
        "insert into dishes (dish_id, household_id, name, url, mood_tags) values ($1, $2, 'x', 'https://e.com', $3::jsonb)",
        [randomUUID(), h, JSON.stringify(tags)],
      );
    await expect(insert(['a', 'b', 'c', 'd', 'e'])).resolves.toBeTruthy();
    await expect(insert(['a', 'b', 'c', 'd', 'e', 'f'])).rejects.toThrow();
  });
});

describe('移行', () => {
  it('2 回目の適用では何もしない（冪等）', async () => {
    const { migrate } = await import('@/db');
    expect(await migrate(db)).toEqual([]);
  });
});
