import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { createDish, removeDish } from '@/domain/dish';
import { DomainError } from '@/domain/errors';
import {
  countMatching,
  nextCandidate,
  pick,
  pickedList,
  randomCandidate,
  setImpressionJudge,
  type CandidateFilter,
  type NextCandidate,
} from '@/domain/suggestion';
import { listDishes } from '@/repo/dishes';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import {
  DISLIKE_LIMIT,
  addDislike,
  buildSearchQuery,
  emptyTasteExclusion,
  ensureTasteHandlers,
  getTasteExclusion,
  listMyDislikes,
  moodTagOptions,
  parseCandidateFilter,
  removeDislike,
  setTasteExclusion,
  tasteExclusion,
  youtubeSearchUrl,
} from '../index';

let deps: AppDeps;
let clock: TestClock;
let rand = 0;
beforeAll(async () => {
  ({ deps, clock } = await createTestDeps({ random: () => rand }));
});
afterAll(async () => {
  await deps.db.close();
});
afterEach(() => {
  rand = 0;
  setTasteExclusion(tasteExclusion);
  setImpressionJudge(null);
});

const ing = (...names: string[]) => names.map((name) => ({ name, amount: null, unit: null }));

/** 初期データなしの空のグループ（数えやすくする） */
async function emptyHousehold(label: string) {
  const u = await registerWithHousehold(deps, label);
  for (const d of await listDishes(deps.db, u.householdId)) await removeDish(deps, u.ctx, d.dishId);
  return u;
}

type Household = Awaited<ReturnType<typeof emptyHousehold>>;

let urlSeq = 0;
const addDish = (u: Household, name: string, over: Record<string, unknown> = {}) =>
  createDish(deps, u.ctx, { name, url: `https://example.com/${(urlSeq += 1)}`, ...over });

/** 同じグループに、メンバーをもう 1 人加える（アカウントなしの行でよい） */
async function addMember(u: Household) {
  const memberId = randomUUID();
  await deps.db.query(
    'insert into members (member_id, household_id, display_name) values ($1,$2,$3)',
    [memberId, u.householdId, 'family'],
  );
  return { householdId: u.householdId, memberId };
}

/** 候補を最後まで見て、出てきた料理名を集める（パスし続ける） */
async function allCandidates(u: Household, filter?: CandidateFilter): Promise<string[]> {
  const seen: string[] = [];
  const names: string[] = [];
  for (;;) {
    const next = await nextCandidate(deps, u.householdId, seen, filter);
    if (next.status !== 'card') return names;
    names.push(next.dish.name);
    seen.push(next.dish.dishId);
  }
}

const status = async (u: Household, filter?: CandidateFilter, seen: string[] = []) =>
  (await nextCandidate(deps, u.householdId, seen, filter)).status;

describe('嫌いな食材の登録（BR10.1〜BR10.3）', () => {
  it('前後の空白を除いて保存する。空白以外は変えない（読み替えない）', async () => {
    const u = await registerWithHousehold(deps, 'reg');
    const r = await addDislike(deps, u.ctx, { ingredientName: '  えび　' });
    expect(r.created).toBe(true);
    expect(r.dislike.ingredientName).toBe('えび');
    clock.advanceMs(1000);
    const kanji = await addDislike(deps, u.ctx, { ingredientName: '海老' });
    expect(kanji.dislike.ingredientName).toBe('海老');
    expect((await listMyDislikes(deps, u.ctx)).map((d) => d.ingredientName)).toEqual([
      'えび',
      '海老',
    ]);
  });

  it.each([
    ['空', { ingredientName: '' }],
    ['空白だけ', { ingredientName: '   ' }],
    ['51 文字', { ingredientName: 'あ'.repeat(51) }],
    ['文字列でない', { ingredientName: 123 }],
    ['項目がない', {}],
  ])('登録できない：%s（入力エラー、メッセージつき）', async (_label, body) => {
    const u = await registerWithHousehold(deps, 'inval');
    const err = await addDislike(deps, u.ctx, body).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('validation');
    expect(err.fields.ingredientName).toBe('食材名は 1〜50 文字で入力してください');
    expect(await listMyDislikes(deps, u.ctx)).toEqual([]);
  });

  it('50 文字ちょうどは登録できる。絵文字などの 1 文字も 1 文字と数える', async () => {
    const u = await registerWithHousehold(deps, 'len');
    await expect(
      addDislike(deps, u.ctx, { ingredientName: 'あ'.repeat(50) }),
    ).resolves.toBeDefined();
    await expect(
      addDislike(deps, u.ctx, { ingredientName: '🍤'.repeat(50) }),
    ).resolves.toBeDefined();
    await expect(addDislike(deps, u.ctx, { ingredientName: '🍤'.repeat(51) })).rejects.toThrow();
  });

  it('同じ食材名を繰り返しても 1 件のまま、成功として返す（BR10.2）', async () => {
    const u = await registerWithHousehold(deps, 'dup');
    const first = await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    const second = await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    expect(second.created).toBe(false);
    expect(second.dislike.id).toBe(first.dislike.id);
    expect(await listMyDislikes(deps, u.ctx)).toHaveLength(1);
  });

  it('同時に同じ登録が来ても 1 件だけ（BR10.2）', async () => {
    const u = await registerWithHousehold(deps, 'race');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => addDislike(deps, u.ctx, { ingredientName: 'えび' })),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.dislike.id)).size).toBe(1);
    expect(await listMyDislikes(deps, u.ctx)).toHaveLength(1);
  });

  it('1 人 50 件まで。51 件目は登録できず、案内が出る。すでにある食材の再登録は件数に数えない（BR10.3）', async () => {
    const u = await registerWithHousehold(deps, 'limit');
    for (let i = 0; i < DISLIKE_LIMIT; i++) {
      await addDislike(deps, u.ctx, { ingredientName: `食材${i}` });
    }
    const err = await addDislike(deps, u.ctx, { ingredientName: '食材50' }).catch((e) => e);
    expect(err.code).toBe('validation');
    expect(err.fields.ingredientName).toBe(
      '登録できるのは 50 件までです。使わないものを外してください',
    );
    expect((await addDislike(deps, u.ctx, { ingredientName: '食材0' })).created).toBe(false);
    const [first] = await listMyDislikes(deps, u.ctx);
    await removeDislike(deps, u.ctx, first.id);
    await expect(addDislike(deps, u.ctx, { ingredientName: '食材50' })).resolves.toBeDefined();
  });

  it('50 件の上限は人ごと。家族の登録は数えない', async () => {
    const u = await registerWithHousehold(deps, 'limit2');
    const other = await addMember(u);
    for (let i = 0; i < DISLIKE_LIMIT; i++) {
      await addDislike(deps, u.ctx, { ingredientName: `食材${i}` });
    }
    await expect(addDislike(deps, other, { ingredientName: '食材0' })).resolves.toMatchObject({
      created: true,
    });
  });

  it('抜けたメンバー・存在しないメンバーとしては登録できない（見つからない）', async () => {
    const u = await registerWithHousehold(deps, 'ghost');
    await deps.db.query('update members set left_at = now() where member_id = $1', [u.memberId]);
    const left = await addDislike(deps, u.ctx, { ingredientName: 'えび' }).catch((e) => e);
    expect(left.code).toBe('not_found');
    const stranger = await addDislike(
      deps,
      { householdId: u.householdId, memberId: randomUUID() },
      { ingredientName: 'えび' },
    ).catch((e) => e);
    expect(stranger.code).toBe('not_found');
  });

  it('メンバーと別のグループの組み合わせでは登録できない（グループは入口で決めた値だけを使う。BR10.23）', async () => {
    const a = await registerWithHousehold(deps, 'cross-a');
    const b = await registerWithHousehold(deps, 'cross-b');
    const err = await addDislike(
      deps,
      { householdId: b.householdId, memberId: a.memberId },
      { ingredientName: 'えび' },
    ).catch((e) => e);
    expect(err.code).toBe('not_found');
  });
});

describe('一覧と解除（BR10.4、BR10.5）', () => {
  it('自分の登録だけを、登録の古い順に出す。家族の登録は出さない', async () => {
    const u = await registerWithHousehold(deps, 'list');
    const family = await addMember(u);
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    clock.advanceMs(1000);
    await addDislike(deps, family, { ingredientName: 'セロリ' });
    clock.advanceMs(1000);
    await addDislike(deps, u.ctx, { ingredientName: 'ピーマン' });
    expect((await listMyDislikes(deps, u.ctx)).map((d) => d.ingredientName)).toEqual([
      'えび',
      'ピーマン',
    ]);
    expect((await listMyDislikes(deps, family)).map((d) => d.ingredientName)).toEqual(['セロリ']);
  });

  it('本人は外せる。外すと、その食材は除外の対象でなくなる', async () => {
    const u = await emptyHousehold('unreg');
    await addDish(u, 'えび料理', { ingredients: ing('えび') });
    const { dislike } = await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    expect(await allCandidates(u)).toEqual([]);
    await removeDislike(deps, u.ctx, dislike.id);
    expect(await allCandidates(u)).toEqual(['えび料理']);
  });

  it('家族の登録・他のグループの登録・存在しない ID・形の違う ID は「見つからない」で、何も変わらない', async () => {
    const a = await registerWithHousehold(deps, 'rm-a');
    const family = await addMember(a);
    const b = await registerWithHousehold(deps, 'rm-b');
    const mine = (await addDislike(deps, a.ctx, { ingredientName: 'えび' })).dislike;
    for (const ctx of [family, b.ctx]) {
      const err = await removeDislike(deps, ctx, mine.id).catch((e) => e);
      expect(err.code).toBe('not_found');
    }
    for (const bad of [randomUUID(), 'not-a-uuid', '']) {
      const err = await removeDislike(deps, a.ctx, bad).catch((e) => e);
      expect(err.code).toBe('not_found');
    }
    expect(await listMyDislikes(deps, a.ctx)).toHaveLength(1);
  });
});

describe('除外（BR10.6〜BR10.9）', () => {
  it('材料に「えび」を含む料理は候補に出ない。「海老」「エビ」の料理は外れない（正規化しない）', async () => {
    const u = await emptyHousehold('ex');
    await addDish(u, 'えびチリ', { ingredients: ing('えび', '長ねぎ') });
    await addDish(u, 'むきえびの炒め物', { ingredients: ing('むきえび') });
    await addDish(u, '海老フライ', { ingredients: ing('海老') });
    await addDish(u, 'エビマヨ', { ingredients: ing('エビ') });
    await addDish(u, '肉じゃが', { ingredients: ing('牛肉', 'じゃがいも') });
    expect(await allCandidates(u)).toHaveLength(5);
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    expect((await allCandidates(u)).sort()).toEqual(['エビマヨ', '海老フライ', '肉じゃが'].sort());
  });

  it('家族の誰かの登録でも除外される（グループの全員分）', async () => {
    const u = await emptyHousehold('fam');
    const family = await addMember(u);
    await addDish(u, 'セロリサラダ', { ingredients: ing('セロリ') });
    await addDish(u, 'ゴーヤ炒め', { ingredients: ing('ゴーヤ') });
    await addDish(u, 'ご飯', { ingredients: ing('米') });
    await addDislike(deps, u.ctx, { ingredientName: 'セロリ' });
    await addDislike(deps, family, { ingredientName: 'ゴーヤ' });
    expect(await allCandidates(u)).toEqual(['ご飯']);
    expect(await tasteExclusion.listExcludedIngredients(deps, u.householdId)).toEqual([
      'ゴーヤ',
      'セロリ',
    ]);
  });

  it('退会したメンバーの登録は使わない（登録が残っていても）', async () => {
    const u = await emptyHousehold('left');
    const family = await addMember(u);
    await addDish(u, 'セロリサラダ', { ingredients: ing('セロリ') });
    await addDislike(deps, family, { ingredientName: 'セロリ' });
    expect(await allCandidates(u)).toEqual([]);
    await deps.db.query('update members set left_at = now() where member_id = $1', [
      family.memberId,
    ]);
    expect(await allCandidates(u)).toEqual(['セロリサラダ']);
  });

  it('他のグループの登録は影響しない', async () => {
    const a = await emptyHousehold('iso-a');
    const b = await emptyHousehold('iso-b');
    await addDish(a, 'えび料理', { ingredients: ing('えび') });
    await addDish(b, 'えび料理', { ingredients: ing('えび') });
    await addDislike(deps, a.ctx, { ingredientName: 'えび' });
    expect(await allCandidates(a)).toEqual([]);
    expect(await allCandidates(b)).toEqual(['えび料理']);
  });

  it('材料が未入力の料理は外れずに出る（BR10.9）。カードの材料は 0 行', async () => {
    const u = await emptyHousehold('noing');
    await addDish(u, '材料なし', { ingredients: [] });
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    const next = await nextCandidate(deps, u.householdId);
    expect(next.status).toBe('card');
    if (next.status === 'card') expect(next.dish.ingredients).toEqual([]);
  });

  it('すでに「選んだもの」に入れた料理は、後から除外が増えても選んだものに残る（BR10.8）', async () => {
    const u = await emptyHousehold('picked');
    const d = await addDish(u, 'えび料理', { ingredients: ing('えび') });
    await pick(deps, u.ctx, d.dishId);
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    expect((await pickedList(deps, u.ctx)).map((p) => p.dish.name)).toEqual(['えび料理']);
  });
});

describe('絞り込み（BR10.11〜BR10.13）と件数', () => {
  async function filterHousehold() {
    const u = await emptyHousehold('flt');
    await addDish(u, '速くて楽', { cookTime: 'within15', effort: 'easy', moodTags: ['さっぱり'] });
    await addDish(u, '30分ふつう', {
      cookTime: 'within30',
      effort: 'normal',
      moodTags: ['がっつり', 'さっぱり'],
    });
    await addDish(u, '長くて大変', { cookTime: 'over30', effort: 'hard', moodTags: ['がっつり'] });
    await addDish(u, '未入力', {});
    return u;
  }

  it('何も指定しなければ全件。空の条件も同じ', async () => {
    const u = await filterHousehold();
    expect(await allCandidates(u)).toHaveLength(4);
    expect(await allCandidates(u, {})).toHaveLength(4);
    expect(await allCandidates(u, { cookTime: null, effort: null, moodTags: [] })).toHaveLength(4);
  });

  it('調理時間と手間の両方を指定すると、両方に合うものだけ。件数が一致する', async () => {
    const u = await filterHousehold();
    const filter: CandidateFilter = { cookTime: 'within30', effort: 'normal' };
    expect(await allCandidates(u, filter)).toEqual(['30分ふつう']);
    expect(await countMatching(deps, u.householdId, filter)).toBe(1);
    expect(await countMatching(deps, u.householdId, { cookTime: 'within30' })).toBe(2);
    expect(await countMatching(deps, u.householdId, { moodTags: ['がっつり'] })).toBe(2);
    expect(await countMatching(deps, u.householdId)).toBe(4);
  });

  it('件数は、除外を適用した後の数。選んだもの・見た料理は引かない', async () => {
    const u = await emptyHousehold('cnt');
    const a = await addDish(u, 'a', { cookTime: 'within15', ingredients: ing('卵') });
    await addDish(u, 'b', { cookTime: 'within15', ingredients: ing('えび') });
    await addDish(u, 'c', { cookTime: 'within15', ingredients: ing('豆腐') });
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    await pick(deps, u.ctx, a.dishId);
    expect(await countMatching(deps, u.householdId, { cookTime: 'within15' })).toBe(2);
    const card = await nextCandidate(deps, u.householdId, [], { cookTime: 'within15' });
    expect(card.status === 'card' && card.dish.name).toBe('c');
  });

  it('絞り込みで 0 件なら no_match（「緩めてみてください」の案内。BR10.19）', async () => {
    const u = await filterHousehold();
    expect(await status(u, { cookTime: 'over30', effort: 'easy' })).toBe('no_match');
    expect(await status(u, { moodTags: ['ない'] })).toBe('no_match');
  });

  it('該当はあるが、すべて見た・選んだなら「見終えた」であって、no_match ではない（BR10.19）', async () => {
    const u = await filterHousehold();
    const first = await nextCandidate(deps, u.householdId, [], { cookTime: 'over30' });
    expect(first.status).toBe('card');
    if (first.status !== 'card') return;
    expect(await status(u, { cookTime: 'over30' }, [first.dish.dishId])).toBe('done');
    await pick(deps, u.ctx, first.dish.dishId);
    expect(await status(u, { cookTime: 'over30' })).toBe('done');
  });

  it('絞り込みなしで除外のせいで 0 件なら all_excluded（嫌いな食材の見直しの案内。BR10.20）', async () => {
    const u = await emptyHousehold('allex');
    await addDish(u, 'えびチリ', { ingredients: ing('えび') });
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    expect(await status(u)).toBe('all_excluded');
    // 絞り込みを指定していれば no_match（BR10.19 が先）
    expect(await status(u, { cookTime: 'within15' })).toBe('no_match');
  });

  it('保存が 0 件なら empty（U1 の案内。絞り込みの有無によらない）', async () => {
    const u = await emptyHousehold('none');
    expect(await status(u)).toBe('empty');
    expect(await status(u, { cookTime: 'within15' })).toBe('empty');
    expect((await randomCandidate(deps, u.householdId)).status).toBe('empty');
  });

  it('候補の取得は U1 のまま：見た料理・選んだ料理は出ない、全部見たら done', async () => {
    const u = await emptyHousehold('u1');
    const a = await addDish(u, 'a');
    await addDish(u, 'b');
    expect(await status(u, undefined, [a.dishId])).toBe('card');
    await pick(deps, u.ctx, a.dishId);
    const next = await nextCandidate(deps, u.householdId);
    expect(next.status === 'card' && next.dish.name).toBe('b');
    expect(next.status === 'card' && next.remaining).toBe(0);
    expect(
      await status(u, undefined, [
        (next as Extract<NextCandidate, { status: 'card' }>).dish.dishId,
      ]),
    ).toBe('done');
  });

  it('「もう作りたくない」の並べ替え（U5 の拡張点）は、除外・絞り込みの後も働く', async () => {
    const u = await emptyHousehold('judge');
    const a = await addDish(u, 'a', { cookTime: 'within15' });
    await addDish(u, 'b', { cookTime: 'within15' });
    await addDish(u, 'c', { cookTime: 'over30' });
    setImpressionJudge(
      async (_d, _h, ids) =>
        new Map(
          ids.map((id) => [id, id === a.dishId ? ('never_again' as const) : ('none' as const)]),
        ),
    );
    const next = await nextCandidate(deps, u.householdId, [], { cookTime: 'within15' });
    expect(next.status === 'card' && next.dish.name).toBe('b');
  });
});

describe('おまかせ（BR10.16）', () => {
  it('絞り込みなしで 1 件。除外は適用し、パスした料理・選んだものは外さない', async () => {
    const u = await emptyHousehold('rand');
    const keep = await addDish(u, 'ご飯', { ingredients: ing('米') });
    await addDish(u, 'えびチリ', { ingredients: ing('えび') });
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    await pick(deps, u.ctx, keep.dishId);
    const r = await randomCandidate(deps, u.householdId);
    expect(r.status === 'card' && r.dish.name).toBe('ご飯');
    // 選んだものだけが残るとき、候補は done だが、おまかせは出せる
    expect(await status(u)).toBe('done');
  });

  it('乱数で選ぶ。対象の外には出ない', async () => {
    const u = await emptyHousehold('rand2');
    await addDish(u, 'a');
    await addDish(u, 'b');
    await addDish(u, 'c');
    const names = new Set<string>();
    for (const r of [0, 0.4, 0.99]) {
      rand = r;
      const x = await randomCandidate(deps, u.householdId);
      if (x.status === 'card') names.add(x.dish.name);
    }
    expect(names.size).toBe(3);
  });

  it('除外で全部外れたら all_excluded（BR10.20）', async () => {
    const u = await emptyHousehold('rand3');
    await addDish(u, 'えびチリ', { ingredients: ing('えび') });
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    expect((await randomCandidate(deps, u.householdId)).status).toBe('all_excluded');
  });
});

describe('窓口 TasteExclusion（BR10.25）', () => {
  it('既定の実装は空の除外。本物を差し込むまでは、除外なしの動き（U1 のまま）', async () => {
    const u = await emptyHousehold('slot');
    await addDish(u, 'えび料理', { ingredients: ing('えび') });
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    setTasteExclusion(null);
    expect(getTasteExclusion()).toBe(emptyTasteExclusion);
    expect(await emptyTasteExclusion.listExcludedIngredients(deps, u.householdId)).toEqual([]);
    expect(await allCandidates(u)).toEqual(['えび料理']);
    setTasteExclusion(tasteExclusion);
    expect(await allCandidates(u)).toEqual([]);
  });

  it('除外の一覧が取れなかったときは、除外なしの候補を出さず、失敗をそのまま返す。再試行もしない', async () => {
    const u = await emptyHousehold('fail');
    await addDish(u, 'えび料理', { ingredients: ing('えび') });
    let calls = 0;
    setTasteExclusion({
      async listExcludedIngredients() {
        calls += 1;
        throw new Error('taste down');
      },
    });
    await expect(nextCandidate(deps, u.householdId)).rejects.toThrow('taste down');
    await expect(randomCandidate(deps, u.householdId)).rejects.toThrow('taste down');
    await expect(countMatching(deps, u.householdId)).rejects.toThrow('taste down');
    expect(calls).toBe(3);
  });

  it('本物の実装は、グループの範囲だけを返す', async () => {
    const a = await registerWithHousehold(deps, 'slot-a');
    const b = await registerWithHousehold(deps, 'slot-b');
    await addDislike(deps, a.ctx, { ingredientName: 'えび' });
    expect(await tasteExclusion.listExcludedIngredients(deps, a.householdId)).toEqual(['えび']);
    expect(await tasteExclusion.listExcludedIngredients(deps, b.householdId)).toEqual([]);
  });
});

describe('気分のタグの選択肢（BR10.10）', () => {
  it('グループの削除済みでない料理のタグを集める', async () => {
    const u = await emptyHousehold('tags');
    await addDish(u, 'a', { moodTags: ['さっぱり', 'がっつり'] });
    const gone = await addDish(u, 'b', { moodTags: ['消えた'] });
    await removeDish(deps, u.ctx, gone.dishId);
    expect(await moodTagOptions(deps, u.ctx)).toEqual(['がっつり', 'さっぱり']);
  });
});

describe('出来事の受け口（BR10.21、BR10.22）', () => {
  it('household.member-left：そのメンバーの登録をすべて消す。何度受けても同じ。他の人は消えない', async () => {
    const u = await registerWithHousehold(deps, 'ev1');
    const family = await addMember(u);
    ensureTasteHandlers(deps);
    await addDislike(deps, u.ctx, { ingredientName: 'えび' });
    await addDislike(deps, family, { ingredientName: 'セロリ' });
    const payload = {
      eventId: randomUUID(),
      householdId: u.householdId,
      memberId: family.memberId,
    };
    await deps.events.publish('household.member-left', payload);
    await deps.events.publish('household.member-left', payload);
    expect(await listMyDislikes(deps, family)).toEqual([]);
    expect(await listMyDislikes(deps, u.ctx)).toHaveLength(1);
    // 対象がなくても成功
    await deps.events.publish('household.member-left', { ...payload, memberId: randomUUID() });
  });

  it('household.deleted：そのグループの登録をすべて消す。他のグループには触れない', async () => {
    const a = await registerWithHousehold(deps, 'ev2a');
    const b = await registerWithHousehold(deps, 'ev2b');
    ensureTasteHandlers(deps);
    ensureTasteHandlers(deps); // 2 回呼んでも受け口は 1 つ
    await addDislike(deps, a.ctx, { ingredientName: 'えび' });
    await addDislike(deps, b.ctx, { ingredientName: 'えび' });
    const payload = { eventId: randomUUID(), householdId: a.householdId };
    await deps.events.publish('household.deleted', payload);
    await deps.events.publish('household.deleted', payload);
    expect(await listMyDislikes(deps, a.ctx)).toEqual([]);
    expect(await listMyDislikes(deps, b.ctx)).toHaveLength(1);
  });

  it('候補を取るだけでも受け口が整う（ルートより先に出来事が来ても取りこぼさない）', async () => {
    const { deps: fresh } = await createTestDeps();
    try {
      const u = await registerWithHousehold(fresh, 'ev3');
      await addDislike(fresh, u.ctx, { ingredientName: 'えび' });
      await nextCandidate(fresh, u.householdId);
      await fresh.events.publish('household.member-left', {
        eventId: randomUUID(),
        householdId: u.householdId,
        memberId: u.memberId,
      });
      expect(await listMyDislikes(fresh, u.ctx)).toEqual([]);
    } finally {
      await fresh.db.close();
    }
  });
});

describe('絞り込み条件の読み取り（BR10.10、BR10.14）', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('何も指定しなければ、すべて未指定', () => {
    expect(parseCandidateFilter(q(''))).toEqual({ cookTime: null, effort: null, moodTags: [] });
    expect(parseCandidateFilter(q('time=&effort=&moodTag='))).toEqual({
      cookTime: null,
      effort: null,
      moodTags: [],
    });
  });

  it('time、effort、moodTag（繰り返し）を読む。同じタグは 1 つにまとめる', () => {
    expect(
      parseCandidateFilter(
        q('time=over30&effort=hard&moodTag=がっつり&moodTag=さっぱり&moodTag=がっつり'),
      ),
    ).toEqual({
      cookTime: 'over30',
      effort: 'hard',
      moodTags: ['がっつり', 'さっぱり'],
    });
  });

  it.each([
    ['time=longer', 'time'],
    ['effort=impossible', 'effort'],
    [`moodTag=${'あ'.repeat(21)}`, 'moodTag.0'],
    [Array.from({ length: 21 }, (_, i) => `moodTag=t${i}`).join('&'), 'moodTag'],
  ])('選択肢以外の値は入力エラー：%s', (query, field) => {
    let err: unknown;
    try {
      parseCandidateFilter(q(query));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('validation');
    expect(Object.keys((err as DomainError).fields ?? {})).toContain(field);
  });
});

describe('外で探す（BR10.17、BR10.18）', () => {
  it('検索語＝気分のタグ（選んだ順）、調理時間の言葉、「レシピ」。手間は入れない', () => {
    expect(buildSearchQuery({ moodTags: ['さっぱり', 'がっつり'], cookTime: 'within15' })).toBe(
      'さっぱり がっつり 15分以内 レシピ',
    );
    expect(buildSearchQuery({ cookTime: 'over30' })).toBe('それ以上 レシピ');
    expect(buildSearchQuery({ cookTime: 'within30' })).toBe('30分以内 レシピ');
  });

  it('何も選んでいなければ「レシピ」だけ', () => {
    expect(buildSearchQuery()).toBe('レシピ');
    expect(buildSearchQuery({ cookTime: null, moodTags: [] })).toBe('レシピ');
  });

  it('YouTube の検索画面の URL にする。記号は変換され、検索の宛先を変えられない', () => {
    expect(youtubeSearchUrl({ moodTags: ['さっぱり'] })).toBe(
      `https://www.youtube.com/results?search_query=${encodeURIComponent('さっぱり レシピ')}`,
    );
    const url = new URL(youtubeSearchUrl({ moodTags: ['a&search_query=x#frag', '../evil?x=1'] }));
    expect(url.origin).toBe('https://www.youtube.com');
    expect(url.pathname).toBe('/results');
    expect([...url.searchParams.keys()]).toEqual(['search_query']);
    expect(url.hash).toBe('');
    expect(url.searchParams.get('search_query')).toBe('a&search_query=x#frag ../evil?x=1 レシピ');
  });
});
