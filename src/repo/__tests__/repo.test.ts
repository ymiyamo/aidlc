import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import { createTestDb } from '@/test-helpers/db';
import { findAccountByEmail, insertAccount } from '../accounts';
import {
  countLiveDishes,
  findUserDishByUrl,
  getDish,
  insertDish,
  insertSeedDish,
  listCandidateIds,
  listDishes,
  listSeedKeys,
  setFavorite,
  softDeleteDish,
  updateDish,
  type DishInput,
} from '../dishes';
import {
  findActiveMemberByAccount,
  insertHousehold,
  insertMember,
  listMembers,
} from '../households';
import { listPicked, pickDish, removePicked } from '../picked';
import { deleteSession, findValidSessionAccount, insertSession } from '../sessions';

let db: Db;
const now = new Date('2026-01-01T00:00:00Z');

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const input = (over: Partial<DishInput> = {}): DishInput => ({
  name: '肉じゃが',
  url: 'https://example.com/a',
  cookTime: null,
  effort: null,
  moodTags: [],
  ingredients: [],
  memo: null,
  ...over,
});

/** グループ 1 つと、そのメンバー 1 人を作る */
async function setup(label: string) {
  const accountId = randomUUID();
  await insertAccount(db, {
    accountId,
    email: `${label}-${accountId}@example.com`,
    passwordDigest: 'x',
  });
  const householdId = randomUUID();
  const memberId = randomUUID();
  await insertHousehold(db, { householdId, name: label, createdAt: now });
  await insertMember(db, { memberId, householdId, accountId, displayName: label, joinedAt: now });
  return { accountId, householdId, memberId };
}

async function addDish(householdId: string, over: Partial<DishInput> = {}, createdAt = now) {
  const dishId = randomUUID();
  await insertDish(db, householdId, { ...input(over), dishId, createdBy: null, now: createdAt });
  return dishId;
}

describe('アカウントとログイン状態', () => {
  it('メールアドレスの重複は null（大文字小文字を無視）、検索も大文字小文字を無視', async () => {
    const id = randomUUID();
    expect(
      await insertAccount(db, { accountId: id, email: 'A@Example.com', passwordDigest: 'd' }),
    ).not.toBeNull();
    expect(
      await insertAccount(db, {
        accountId: randomUUID(),
        email: 'a@example.com',
        passwordDigest: 'd',
      }),
    ).toBeNull();
    expect((await findAccountByEmail(db, 'a@EXAMPLE.com'))?.accountId).toBe(id);
  });

  it('期限内のログイン状態だけが有効。削除すると無効', async () => {
    const { accountId } = await setup('s');
    const hash = randomUUID();
    await insertSession(db, {
      sessionHash: hash,
      accountId,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 1000),
    });
    expect(await findValidSessionAccount(db, hash, now)).toBe(accountId);
    expect(await findValidSessionAccount(db, hash, new Date(now.getTime() + 2000))).toBeNull();
    await deleteSession(db, hash);
    expect(await findValidSessionAccount(db, hash, now)).toBeNull();
  });

  it('アカウントから有効な Member とメンバー一覧を引ける', async () => {
    const a = await setup('m');
    const member = await findActiveMemberByAccount(db, a.accountId);
    expect(member?.householdId).toBe(a.householdId);
    expect((await listMembers(db, a.householdId)).map((m) => m.memberId)).toEqual([a.memberId]);
  });
});

describe('料理：グループの範囲（BR2.3、BR2.4、NFR3.5〜3.7）', () => {
  it('他のグループの料理は、読み取りで見つからない', async () => {
    const a = await setup('a');
    const b = await setup('b');
    const dishId = await addDish(a.householdId);
    expect(await getDish(db, a.householdId, dishId)).not.toBeNull();
    expect(await getDish(db, b.householdId, dishId)).toBeNull();
    expect(await listDishes(db, b.householdId)).toEqual([]);
    expect(await findUserDishByUrl(db, b.householdId, 'https://example.com/a')).toBeNull();
    expect(await listCandidateIds(db, b.householdId)).toEqual([]);
  });

  it('他のグループの料理は、更新・お気に入り・削除のどれもできない', async () => {
    const a = await setup('a2');
    const b = await setup('b2');
    const dishId = await addDish(a.householdId);
    expect(
      await updateDish(db, b.householdId, dishId, { ...input({ name: '乗っ取り' }), now }),
    ).toBe(false);
    expect(await setFavorite(db, b.householdId, dishId, true, now)).toBe(false);
    expect(await softDeleteDish(db, b.householdId, dishId, now)).toBe(false);
    const still = await getDish(db, a.householdId, dishId);
    expect(still?.name).toBe('肉じゃが');
    expect(still?.isFavorite).toBe(false);
  });

  it('他のグループの料理は「選んだもの」にできず、外すこともできない', async () => {
    const a = await setup('a3');
    const b = await setup('b3');
    const dishId = await addDish(a.householdId);
    expect(
      await pickDish(db, b.householdId, {
        pickedId: randomUUID(),
        dishId,
        memberId: b.memberId,
        now,
      }),
    ).toBe(false);
    await pickDish(db, a.householdId, {
      pickedId: randomUUID(),
      dishId,
      memberId: a.memberId,
      now,
    });
    expect(await removePicked(db, b.householdId, dishId)).toBe(false);
    expect(await listPicked(db, b.householdId)).toEqual([]);
    expect(await listPicked(db, a.householdId)).toHaveLength(1);
  });
});

describe('料理：保存・更新・削除', () => {
  it('材料つきで保存して読める。更新で材料が入れ替わる', async () => {
    const a = await setup('ing');
    const dishId = await addDish(a.householdId, {
      moodTags: ['さっぱり'],
      cookTime: 'within15',
      effort: 'easy',
      ingredients: [
        { name: '玉ねぎ', amount: '1', unit: '個' },
        { name: '塩', amount: null, unit: null },
      ],
    });
    const d = await getDish(db, a.householdId, dishId);
    expect(d?.ingredients.map((i) => i.name)).toEqual(['玉ねぎ', '塩']);
    expect(d?.moodTags).toEqual(['さっぱり']);
    await updateDish(db, a.householdId, dishId, {
      ...input({ ingredients: [{ name: '豚肉', amount: '200', unit: 'g' }] }),
      now,
    });
    expect((await getDish(db, a.householdId, dishId))?.ingredients).toEqual([
      { name: '豚肉', amount: '200', unit: 'g' },
    ]);
  });

  it('論理削除した料理は、取得・一覧・候補・件数に出ない。繰り返しても結果は同じ', async () => {
    const a = await setup('del');
    const dishId = await addDish(a.householdId);
    expect(await softDeleteDish(db, a.householdId, dishId, now)).toBe(true);
    expect(await softDeleteDish(db, a.householdId, dishId, now)).toBe(false);
    expect(await getDish(db, a.householdId, dishId)).toBeNull();
    expect(await listDishes(db, a.householdId)).toEqual([]);
    expect(await listCandidateIds(db, a.householdId)).toEqual([]);
    expect(await countLiveDishes(db, a.householdId)).toBe(0);
  });

  it('一覧は更新の新しい順。お気に入りだけの絞り込みもできる', async () => {
    const a = await setup('list');
    const old = await addDish(a.householdId, { name: '古い' }, new Date('2026-01-01T00:00:00Z'));
    const recent = await addDish(
      a.householdId,
      { name: '新しい' },
      new Date('2026-02-01T00:00:00Z'),
    );
    expect((await listDishes(db, a.householdId)).map((d) => d.dishId)).toEqual([recent, old]);
    await setFavorite(db, a.householdId, old, true, new Date('2026-03-01T00:00:00Z'));
    expect(
      (await listDishes(db, a.householdId, { favoriteOnly: true })).map((d) => d.dishId),
    ).toEqual([old]);
  });

  it('同じ URL の確認は、user の料理だけが対象。除外 ID を指定できる', async () => {
    const a = await setup('url');
    const mine = await addDish(a.householdId, { url: 'https://example.com/same' });
    await insertSeedDish(db, a.householdId, {
      ...input({ url: 'https://example.com/seed/x' }),
      dishId: randomUUID(),
      seedKey: 'x',
      now,
    });
    expect((await findUserDishByUrl(db, a.householdId, 'https://example.com/same'))?.dishId).toBe(
      mine,
    );
    expect(await findUserDishByUrl(db, a.householdId, 'https://example.com/seed/x')).toBeNull();
    expect(await findUserDishByUrl(db, a.householdId, 'https://example.com/same', mine)).toBeNull();
  });
});

describe('初期データと選んだもの', () => {
  it('同じ seedKey は 2 回目に作られず、削除しても seedKey は残る', async () => {
    const a = await setup('seed');
    const seed = { ...input(), dishId: randomUUID(), seedKey: 'k1', now };
    expect(await insertSeedDish(db, a.householdId, seed)).toBe(true);
    expect(await insertSeedDish(db, a.householdId, { ...seed, dishId: randomUUID() })).toBe(false);
    await softDeleteDish(db, a.householdId, seed.dishId, now);
    expect(await listSeedKeys(db, a.householdId)).toEqual(['k1']);
  });

  it('選んだ料理は候補から外れ、外すと戻る。二重に選んでも 1 件', async () => {
    const a = await setup('pick');
    const dishId = await addDish(a.householdId);
    const pick = () =>
      pickDish(db, a.householdId, { pickedId: randomUUID(), dishId, memberId: a.memberId, now });
    expect(await pick()).toBe(true);
    expect(await pick()).toBe(true);
    expect(await listPicked(db, a.householdId)).toHaveLength(1);
    expect(await listCandidateIds(db, a.householdId)).toEqual([]);
    expect(await removePicked(db, a.householdId, dishId)).toBe(true);
    expect(await listCandidateIds(db, a.householdId)).toEqual([dishId]);
  });

  it('削除済みの料理を指す「選んだもの」は、一覧から除かれる（BR3.9）', async () => {
    const a = await setup('pickdel');
    const dishId = await addDish(a.householdId);
    await pickDish(db, a.householdId, {
      pickedId: randomUUID(),
      dishId,
      memberId: a.memberId,
      now,
    });
    await softDeleteDish(db, a.householdId, dishId, now);
    expect(await listPicked(db, a.householdId)).toEqual([]);
  });
});
