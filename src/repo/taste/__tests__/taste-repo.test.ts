import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import { createTestDb } from '@/test-helpers/db';
import {
  countMatchingDishes,
  insertDish,
  listCandidateIds,
  listMatchingDishes,
  listMoodTagOptions,
  softDeleteDish,
  type DishInput,
} from '@/repo/dishes';
import { insertHousehold } from '@/repo/households';
import { pickDish } from '@/repo/picked';
import {
  countDislikesOfMember,
  deleteDislike,
  deleteDislikesOfHousehold,
  deleteDislikesOfMember,
  findDislikeByName,
  insertDislike,
  listDislikesOfMember,
  listExcludedNames,
  lockActiveMember,
} from '../index';

let db: Db;
const now = new Date('2026-01-01T00:00:00Z');

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

/** グループ 1 つと、メンバー n 人（アカウントなしの行でよい） */
async function setup(members = 1) {
  const householdId = randomUUID();
  await insertHousehold(db, { householdId, name: 'g', createdAt: now });
  const memberIds: string[] = [];
  for (let i = 0; i < members; i++) {
    const memberId = randomUUID();
    await db.query(
      'insert into members (member_id, household_id, display_name) values ($1,$2,$3)',
      [memberId, householdId, `m${i}`],
    );
    memberIds.push(memberId);
  }
  return { householdId, memberIds, memberId: memberIds[0] };
}

const dishInput = (over: Partial<DishInput> = {}): DishInput => ({
  name: '料理',
  url: 'https://example.com/x',
  cookTime: null,
  effort: null,
  moodTags: [],
  ingredients: [],
  memo: null,
  ...over,
});

const ing = (...names: string[]) => names.map((name) => ({ name, amount: null, unit: null }));

async function addDish(householdId: string, over: Partial<DishInput> = {}) {
  const dishId = randomUUID();
  await insertDish(db, householdId, { ...dishInput(over), dishId, createdBy: null, now });
  return dishId;
}

const dislike = (householdId: string, memberId: string, name: string) =>
  insertDislike(db, householdId, { dislikeId: randomUUID(), memberId, ingredientName: name, now });

const ids = async (householdId: string, opts: Parameters<typeof listCandidateIds>[2] = {}) =>
  new Set(await listCandidateIds(db, householdId, opts));

describe('嫌いな食材の登録（BR10.1〜BR10.5）', () => {
  it('登録して、自分の分だけを古い順に読める。同じ食材名は 2 件目を作らない', async () => {
    const s = await setup(2);
    const [a, b] = s.memberIds;
    expect(await dislike(s.householdId, a, 'えび')).toBe(true);
    expect(await dislike(s.householdId, a, 'えび')).toBe(false);
    await new Promise((r) => setTimeout(r, 2));
    expect(
      await insertDislike(db, s.householdId, {
        dislikeId: randomUUID(),
        memberId: a,
        ingredientName: 'ピーマン',
        now: new Date('2026-01-02T00:00:00Z'),
      }),
    ).toBe(true);
    await dislike(s.householdId, b, 'セロリ');
    expect((await listDislikesOfMember(db, s.householdId, a)).map((r) => r.ingredientName)).toEqual(
      ['えび', 'ピーマン'],
    );
    expect(await countDislikesOfMember(db, s.householdId, a)).toBe(2);
    expect(await countDislikesOfMember(db, s.householdId, b)).toBe(1);
  });

  it('同じ食材名の登録を探せる。他のグループ・他のメンバーの分は見つからない', async () => {
    const s = await setup(2);
    const other = await setup();
    await dislike(s.householdId, s.memberIds[0], 'えび');
    expect(
      (await findDislikeByName(db, s.householdId, s.memberIds[0], 'えび'))?.ingredientName,
    ).toBe('えび');
    expect(await findDislikeByName(db, s.householdId, s.memberIds[1], 'えび')).toBeNull();
    expect(await findDislikeByName(db, other.householdId, s.memberIds[0], 'えび')).toBeNull();
  });

  it('外せるのは本人の登録だけ。他の人・他のグループ・すでにないものは false', async () => {
    const s = await setup(2);
    const other = await setup();
    await dislike(s.householdId, s.memberIds[0], 'えび');
    const [row] = await listDislikesOfMember(db, s.householdId, s.memberIds[0]);
    expect(await deleteDislike(db, s.householdId, s.memberIds[1], row.dislikeId)).toBe(false);
    expect(await deleteDislike(db, other.householdId, other.memberId, row.dislikeId)).toBe(false);
    expect(await deleteDislike(db, s.householdId, s.memberIds[0], row.dislikeId)).toBe(true);
    expect(await deleteDislike(db, s.householdId, s.memberIds[0], row.dislikeId)).toBe(false);
  });

  it('有効なメンバーだけをロックできる（抜けた人・他のグループの人は false）', async () => {
    const s = await setup(2);
    const other = await setup();
    await db.query('update members set left_at = now() where member_id = $1', [s.memberIds[1]]);
    await db.transaction(async (tx) => {
      expect(await lockActiveMember(tx, s.householdId, s.memberIds[0])).toBe(true);
      expect(await lockActiveMember(tx, s.householdId, s.memberIds[1])).toBe(false);
      expect(await lockActiveMember(tx, s.householdId, other.memberId)).toBe(false);
    });
  });

  it('メンバーの全削除は、そのメンバーの分だけ。0 件でも成功。グループの全削除は他のグループに触れない', async () => {
    const s = await setup(2);
    const other = await setup();
    await dislike(s.householdId, s.memberIds[0], 'えび');
    await dislike(s.householdId, s.memberIds[1], 'かに');
    await dislike(other.householdId, other.memberId, 'えび');
    expect(await deleteDislikesOfMember(db, s.householdId, s.memberIds[0])).toBe(1);
    expect(await deleteDislikesOfMember(db, s.householdId, s.memberIds[0])).toBe(0);
    expect(await listExcludedNames(db, s.householdId)).toEqual(['かに']);
    expect(await deleteDislikesOfHousehold(db, s.householdId)).toBe(1);
    expect(await deleteDislikesOfHousehold(db, s.householdId)).toBe(0);
    expect(await listExcludedNames(db, other.householdId)).toEqual(['えび']);
  });
});

describe('除外する食材の一覧（BR10.6）', () => {
  it('家族の全員分をまとめ、同じ食材名は 1 つにする', async () => {
    const s = await setup(3);
    await dislike(s.householdId, s.memberIds[0], 'えび');
    await dislike(s.householdId, s.memberIds[1], 'えび');
    await dislike(s.householdId, s.memberIds[2], 'セロリ');
    expect(await listExcludedNames(db, s.householdId)).toEqual(['えび', 'セロリ']);
  });

  it('退会したメンバーの登録は使わない（登録が残っていても）', async () => {
    const s = await setup(2);
    await dislike(s.householdId, s.memberIds[0], 'えび');
    await dislike(s.householdId, s.memberIds[1], 'セロリ');
    await db.query('update members set left_at = now() where member_id = $1', [s.memberIds[1]]);
    expect(await listExcludedNames(db, s.householdId)).toEqual(['えび']);
  });

  it('他のグループの登録は見えない', async () => {
    const a = await setup();
    const b = await setup();
    await dislike(a.householdId, a.memberId, 'えび');
    await dislike(b.householdId, b.memberId, 'セロリ');
    expect(await listExcludedNames(db, a.householdId)).toEqual(['えび']);
    expect(await listExcludedNames(db, b.householdId)).toEqual(['セロリ']);
  });
});

describe('除外の照合（BR10.7〜BR10.9）', () => {
  it('材料名に除外する文字列を含む料理を外す（部分一致）。「えび」は「むきえび」にも一致', async () => {
    const s = await setup();
    const keep = await addDish(s.householdId, { ingredients: ing('卵') });
    await addDish(s.householdId, { ingredients: ing('えび') });
    await addDish(s.householdId, { ingredients: ing('卵', 'むきえび') });
    expect(await ids(s.householdId, { excluded: ['えび'] })).toEqual(new Set([keep]));
  });

  it('「えび」と「海老」「エビ」は別（正規化しない）。大文字小文字も別', async () => {
    const s = await setup();
    const kanji = await addDish(s.householdId, { ingredients: ing('海老') });
    const kata = await addDish(s.householdId, { ingredients: ing('エビ') });
    const latin = await addDish(s.householdId, { ingredients: ing('Shrimp') });
    expect(await ids(s.householdId, { excluded: ['えび'] })).toEqual(new Set([kanji, kata, latin]));
    expect(await ids(s.householdId, { excluded: ['shrimp'] })).toEqual(
      new Set([kanji, kata, latin]),
    );
    expect(await ids(s.householdId, { excluded: ['Shrimp'] })).toEqual(new Set([kanji, kata]));
  });

  it('料理名・メモ・タグは見ない。材料名だけを照合する', async () => {
    const s = await setup();
    const d = await addDish(s.householdId, {
      name: 'えびフライ',
      memo: 'えび',
      moodTags: ['えび'],
      ingredients: ing('卵'),
    });
    expect(await ids(s.householdId, { excluded: ['えび'] })).toEqual(new Set([d]));
  });

  it('材料が未入力の料理は外さない（BR10.9）', async () => {
    const s = await setup();
    const empty = await addDish(s.householdId, { ingredients: [] });
    expect(await ids(s.householdId, { excluded: ['えび', 'たまご'] })).toEqual(new Set([empty]));
  });

  it('記号を含む食材名も、記号の意味を持たず文字列として照合する（% _ は特別扱いしない）', async () => {
    const s = await setup();
    const plain = await addDish(s.householdId, { ingredients: ing('ねぎ') });
    const percent = await addDish(s.householdId, { ingredients: ing('100%ジュース') });
    expect(await ids(s.householdId, { excluded: ['%'] })).toEqual(new Set([plain]));
    expect(await ids(s.householdId, { excluded: ['_'] })).toEqual(new Set([plain, percent]));
  });

  it('空の食材名は無視する（すべての料理が外れてしまわない）', async () => {
    const s = await setup();
    const d = await addDish(s.householdId, { ingredients: ing('卵') });
    expect(await ids(s.householdId, { excluded: [''] })).toEqual(new Set([d]));
  });

  it('削除済みの料理は対象外。「選んだもの」は候補から引くが、判定の結果には印つきで残る', async () => {
    const s = await setup();
    const live = await addDish(s.householdId);
    const picked = await addDish(s.householdId);
    const gone = await addDish(s.householdId);
    await softDeleteDish(db, s.householdId, gone, now);
    await pickDish(db, s.householdId, {
      pickedId: randomUUID(),
      dishId: picked,
      memberId: s.memberId,
      now,
    });
    expect(await ids(s.householdId)).toEqual(new Set([live]));
    const all = await listMatchingDishes(db, s.householdId);
    expect(new Map(all.map((m) => [m.dishId, m.picked]))).toEqual(
      new Map([
        [live, false],
        [picked, true],
      ]),
    );
  });
});

describe('絞り込み（BR10.10〜BR10.13）', () => {
  async function dishes() {
    const s = await setup();
    const make = (name: string, over: Partial<DishInput>) =>
      addDish(s.householdId, { name, ...over }).then((id) => [name, id] as const);
    const m = Object.fromEntries(
      await Promise.all([
        make('速くて楽', { cookTime: 'within15', effort: 'easy', moodTags: ['さっぱり'] }),
        make('30分ふつう', {
          cookTime: 'within30',
          effort: 'normal',
          moodTags: ['がっつり', 'さっぱり'],
        }),
        make('長くて大変', { cookTime: 'over30', effort: 'hard', moodTags: ['がっつり'] }),
        make('何も未入力', {}),
      ]),
    );
    return { s, m };
  }

  it('条件なしは全件（絞り込みの判定をしない。BR10.12）。未入力の料理も出る', async () => {
    const { s, m } = await dishes();
    expect(await ids(s.householdId, { filter: {} })).toEqual(new Set(Object.values(m)));
    expect(await countMatchingDishes(db, s.householdId)).toBe(4);
  });

  it('調理時間：「15 分以内」は within15 だけ、「30 分以内」は within15 も含む、「それ以上」は over30 だけ', async () => {
    const { s, m } = await dishes();
    expect(await ids(s.householdId, { filter: { cookTime: 'within15' } })).toEqual(
      new Set([m['速くて楽']]),
    );
    expect(await ids(s.householdId, { filter: { cookTime: 'within30' } })).toEqual(
      new Set([m['速くて楽'], m['30分ふつう']]),
    );
    expect(await ids(s.householdId, { filter: { cookTime: 'over30' } })).toEqual(
      new Set([m['長くて大変']]),
    );
  });

  it('手間：同じ値だけ。指定したのに空の料理は合わない', async () => {
    const { s, m } = await dishes();
    expect(await ids(s.householdId, { filter: { effort: 'normal' } })).toEqual(
      new Set([m['30分ふつう']]),
    );
    expect((await ids(s.householdId, { filter: { effort: 'easy' } })).has(m['何も未入力'])).toBe(
      false,
    );
  });

  it('気分のタグ：選んだタグのどれか 1 つでも付いていれば合う。タグが空の料理は合わない', async () => {
    const { s, m } = await dishes();
    expect(await ids(s.householdId, { filter: { moodTags: ['がっつり'] } })).toEqual(
      new Set([m['30分ふつう'], m['長くて大変']]),
    );
    expect(await ids(s.householdId, { filter: { moodTags: ['さっぱり', 'がっつり'] } })).toEqual(
      new Set([m['速くて楽'], m['30分ふつう'], m['長くて大変']]),
    );
    expect(await ids(s.householdId, { filter: { moodTags: ['ない'] } })).toEqual(new Set());
  });

  it('3 種類の条件は AND（調理時間と手間の両方に合うものだけ）', async () => {
    const { s, m } = await dishes();
    expect(await ids(s.householdId, { filter: { cookTime: 'within30', effort: 'easy' } })).toEqual(
      new Set([m['速くて楽']]),
    );
    expect(
      await ids(s.householdId, {
        filter: { cookTime: 'within30', effort: 'normal', moodTags: ['さっぱり'] },
      }),
    ).toEqual(new Set([m['30分ふつう']]));
    expect(await ids(s.householdId, { filter: { cookTime: 'over30', effort: 'easy' } })).toEqual(
      new Set(),
    );
  });

  it('タグの照合も文字列の一致だけ（読み替えなし）', async () => {
    const { s } = await dishes();
    expect(await ids(s.householdId, { filter: { moodTags: ['サッパリ'] } })).toEqual(new Set());
  });

  it('除外と絞り込みを重ねられる。件数は、選んだものを引かずに数える（BR10.13）', async () => {
    const s = await setup();
    const a = await addDish(s.householdId, { cookTime: 'within15', ingredients: ing('卵') });
    await addDish(s.householdId, { cookTime: 'within15', ingredients: ing('えび') });
    await addDish(s.householdId, { cookTime: 'over30', ingredients: ing('卵') });
    await pickDish(db, s.householdId, {
      pickedId: randomUUID(),
      dishId: a,
      memberId: s.memberId,
      now,
    });
    const opts = { excluded: ['えび'], filter: { cookTime: 'within15' as const } };
    expect(await countMatchingDishes(db, s.householdId, opts)).toBe(1);
    expect(await ids(s.householdId, opts)).toEqual(new Set());
  });

  it('他のグループの料理は数えない・返さない', async () => {
    const a = await setup();
    const b = await setup();
    await addDish(a.householdId);
    await addDish(b.householdId);
    await addDish(b.householdId);
    expect(await countMatchingDishes(db, a.householdId)).toBe(1);
    expect(await countMatchingDishes(db, b.householdId)).toBe(2);
  });
});

describe('気分のタグの選択肢（BR10.10）', () => {
  it('削除済みでない料理のタグを、重複なしで集める。他のグループのタグは混ざらない', async () => {
    const a = await setup();
    const b = await setup();
    await addDish(a.householdId, { moodTags: ['さっぱり', 'がっつり'] });
    await addDish(a.householdId, { moodTags: ['さっぱり'] });
    const gone = await addDish(a.householdId, { moodTags: ['消えた'] });
    await softDeleteDish(db, a.householdId, gone, now);
    await addDish(b.householdId, { moodTags: ['よそ'] });
    expect(await listMoodTagOptions(db, a.householdId)).toEqual(['がっつり', 'さっぱり']);
    expect(await listMoodTagOptions(db, b.householdId)).toEqual(['よそ']);
  });
});
