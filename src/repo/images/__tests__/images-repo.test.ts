import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { createDish } from '@/domain/dish';
import { createMemoryStorage, newStorageKey } from '@/lib/storage';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import {
  bumpAttempt,
  countGenerated,
  deleteImagesOfDish,
  deleteImagesOfHousehold,
  deleteRegistered,
  getGenerated,
  getRegistered,
  insertGeneratedPending,
  markFailed,
  markReady,
  restartGenerated,
  upsertRegistered,
} from '../index';

let deps: AppDeps;
beforeAll(async () => {
  ({ deps } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

const NOW = new Date('2026-10-10T00:00:00Z');

async function world(label: string) {
  const u = await registerWithHousehold(deps, label);
  const dish = await createDish(deps, u.ctx, {
    name: `${label}の料理`,
    url: `https://example.com/${label}`,
  });
  return { ...u, dish };
}

const put = (
  w: { householdId: string; memberId: string; dish: { dishId: string } },
  key = newStorageKey('registered'),
) =>
  upsertRegistered(deps.db, w.householdId, {
    imageId: crypto.randomUUID(),
    dishId: w.dish.dishId,
    contentType: 'png',
    byteSize: 10,
    storageKey: key,
    uploadedBy: w.memberId,
    now: NOW,
  });

describe('登録画像', () => {
  it('置くと読め、再び置くと置き換わり、古い保管の名前が返る', async () => {
    const w = await world('reg1');
    const k1 = newStorageKey('registered');
    const k2 = newStorageKey('registered');
    expect((await put(w, k1)).replacedStorageKey).toBeNull();
    expect((await getRegistered(deps.db, w.householdId, w.dish.dishId))?.storageKey).toBe(k1);
    expect((await put(w, k2)).replacedStorageKey).toBe(k1);
    const row = await getRegistered(deps.db, w.householdId, w.dish.dishId);
    expect(row?.storageKey).toBe(k2);
    expect(row?.uploadedBy).toBe(w.memberId);
    const n = await deps.db.query(
      'select count(*) as n from registered_images where dish_id = $1',
      [w.dish.dishId],
    );
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it('他のグループの画像は読めず、外せず、置き換えもできない', async () => {
    const a = await world('regA');
    const b = await world('regB');
    await put(a);
    expect(await getRegistered(deps.db, b.householdId, a.dish.dishId)).toBeNull();
    expect(await deleteRegistered(deps.db, b.householdId, a.dish.dishId)).toBeNull();
    // 他のグループの householdId で同じ料理に置こうとしても、元の画像は変わらない
    const before = await getRegistered(deps.db, a.householdId, a.dish.dishId);
    await put({ householdId: b.householdId, memberId: b.memberId, dish: a.dish });
    expect((await getRegistered(deps.db, a.householdId, a.dish.dishId))?.storageKey).toBe(
      before?.storageKey,
    );
  });

  it('外すと保管の名前が返り、もう一度外しても null（冪等）', async () => {
    const w = await world('reg2');
    const key = newStorageKey('registered');
    await put(w, key);
    expect(await deleteRegistered(deps.db, w.householdId, w.dish.dishId)).toBe(key);
    expect(await deleteRegistered(deps.db, w.householdId, w.dish.dishId)).toBeNull();
    expect(await getRegistered(deps.db, w.householdId, w.dish.dishId)).toBeNull();
  });
});

describe('生成画像', () => {
  it('pending を 1 件だけ作り、重ねての要求は作らない（冪等）', async () => {
    const w = await world('gen1');
    const make = () =>
      insertGeneratedPending(deps.db, w.householdId, {
        generatedImageId: crypto.randomUUID(),
        dishId: w.dish.dishId,
        now: NOW,
      });
    expect(await make()).toBe(true);
    expect(await make()).toBe(false);
    const g = await getGenerated(deps.db, w.householdId, w.dish.dishId);
    expect(g).toMatchObject({ status: 'pending', attemptCount: 0, storageKey: null });
  });

  it('試行は 4 回まで数え、ready にできるのは pending のときだけ', async () => {
    const w = await world('gen2');
    const gid = crypto.randomUUID();
    await insertGeneratedPending(deps.db, w.householdId, {
      generatedImageId: gid,
      dishId: w.dish.dishId,
      now: NOW,
    });
    for (const n of [1, 2, 3, 4]) expect(await bumpAttempt(deps.db, w.householdId, gid)).toBe(n);
    expect(await bumpAttempt(deps.db, w.householdId, gid)).toBeNull();
    const key = newStorageKey('generated');
    expect(
      await markReady(deps.db, w.householdId, gid, {
        storageKey: key,
        contentType: 'png',
        now: NOW,
      }),
    ).toBe(true);
    expect(await markFailed(deps.db, w.householdId, gid, NOW)).toBe(false);
    expect((await getGenerated(deps.db, w.householdId, w.dish.dishId))?.status).toBe('ready');
  });

  it('期限切れの pending だけ作り直せる。期限内の pending と ready は作り直さない', async () => {
    const w = await world('gen3');
    const gid = crypto.randomUUID();
    await insertGeneratedPending(deps.db, w.householdId, {
      generatedImageId: gid,
      dishId: w.dish.dishId,
      now: NOW,
    });
    const ttl = 10 * 60 * 1000;
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    // 9 分 59 秒：期限内
    expect(
      await restartGenerated(deps.db, w.householdId, w.dish.dishId, {
        now: at(ttl - 1000),
        expiredBefore: new Date(at(ttl - 1000).getTime() - ttl),
        includeFailed: false,
      }),
    ).toBeNull();
    // 10 分ちょうど：期限切れ
    const again = await restartGenerated(deps.db, w.householdId, w.dish.dishId, {
      now: at(ttl),
      expiredBefore: new Date(at(ttl).getTime() - ttl),
      includeFailed: false,
    });
    expect(again).toMatchObject({ status: 'pending', attemptCount: 0 });
    expect(again?.requestedAt.getTime()).toBe(at(ttl).getTime());
  });

  it('failed は、明示のときだけ作り直せる', async () => {
    const w = await world('gen4');
    const gid = crypto.randomUUID();
    await insertGeneratedPending(deps.db, w.householdId, {
      generatedImageId: gid,
      dishId: w.dish.dishId,
      now: NOW,
    });
    await markFailed(deps.db, w.householdId, gid, NOW);
    const args = { now: NOW, expiredBefore: new Date(NOW.getTime() - 1), includeFailed: false };
    expect(await restartGenerated(deps.db, w.householdId, w.dish.dishId, args)).toBeNull();
    expect(
      await restartGenerated(deps.db, w.householdId, w.dish.dishId, {
        ...args,
        includeFailed: true,
      }),
    ).toMatchObject({ status: 'pending' });
  });

  it('他のグループの生成画像は読めず、状態も変えられない', async () => {
    const a = await world('genA');
    const b = await world('genB');
    const gid = crypto.randomUUID();
    await insertGeneratedPending(deps.db, a.householdId, {
      generatedImageId: gid,
      dishId: a.dish.dishId,
      now: NOW,
    });
    expect(await getGenerated(deps.db, b.householdId, a.dish.dishId)).toBeNull();
    expect(await markFailed(deps.db, b.householdId, gid, NOW)).toBe(false);
    expect(await bumpAttempt(deps.db, b.householdId, gid)).toBeNull();
    expect(await countGenerated(deps.db, b.householdId)).toBe(0);
    expect(await countGenerated(deps.db, a.householdId)).toBe(1);
  });
});

describe('削除の連動と保管', () => {
  it('料理の画像だけを消し、消した保管の名前を返す。繰り返しても同じ', async () => {
    const w = await world('del1');
    const other = await createDish(deps, w.ctx, {
      name: '別の料理',
      url: 'https://example.com/del1b',
    });
    const key = newStorageKey('registered');
    await put(w, key);
    const gid = crypto.randomUUID();
    await insertGeneratedPending(deps.db, w.householdId, {
      generatedImageId: gid,
      dishId: w.dish.dishId,
      now: NOW,
    });
    const gkey = newStorageKey('generated');
    await markReady(deps.db, w.householdId, gid, {
      storageKey: gkey,
      contentType: 'png',
      now: NOW,
    });
    await put({ ...w, dish: other });

    expect((await deleteImagesOfDish(deps.db, w.householdId, w.dish.dishId)).sort()).toEqual(
      [key, gkey].sort(),
    );
    expect(await deleteImagesOfDish(deps.db, w.householdId, w.dish.dishId)).toEqual([]);
    expect(await getRegistered(deps.db, w.householdId, other.dishId)).not.toBeNull();
  });

  it('グループの画像をすべて消すが、他のグループには触れない', async () => {
    const a = await world('delA');
    const b = await world('delB');
    await put(a);
    await put(b);
    expect(await deleteImagesOfHousehold(deps.db, a.householdId)).toHaveLength(1);
    expect(await deleteImagesOfHousehold(deps.db, a.householdId)).toEqual([]);
    expect(await getRegistered(deps.db, b.householdId, b.dish.dishId)).not.toBeNull();
  });

  it('保管：書いて読めて、消せる（無くても消せる）。決まった形でない名前は拒否する', async () => {
    const st = createMemoryStorage();
    const key = newStorageKey('registered');
    expect(await st.get(key)).toBeNull();
    await st.put(key, new Uint8Array([1, 2, 3]));
    expect(Array.from((await st.get(key))!)).toEqual([1, 2, 3]);
    await st.delete(key);
    await st.delete(key);
    expect(await st.get(key)).toBeNull();
    await expect(st.put('../etc/passwd', new Uint8Array([1]))).rejects.toThrow(
      'invalid_storage_key',
    );
    expect(newStorageKey('generated')).not.toBe(newStorageKey('generated'));
  });
});
