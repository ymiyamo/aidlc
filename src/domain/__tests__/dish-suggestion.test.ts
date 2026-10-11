import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listDishes } from '@/repo/dishes';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import type { AppDeps } from '../deps';
import {
  createDish,
  editDish,
  findDish,
  markFavorite,
  removeDish,
  listHouseholdDishes,
} from '../dish';
import { nextCandidate, pick, pickedList, unpick } from '../suggestion';

let deps: AppDeps;
let rand = 0;
beforeAll(async () => {
  ({ deps } = await createTestDeps({ random: () => rand }));
});
afterAll(async () => {
  await deps.db.close();
});

const dish = (over: Record<string, unknown> = {}) => ({
  name: '麻婆なす',
  url: 'https://example.com/mapo',
  ...over,
});

/** 初期データなしの空のグループ（候補のテストを数えやすくする） */
async function emptyHousehold(label: string) {
  const u = await registerWithHousehold(deps, label);
  for (const d of await listDishes(deps.db, u.householdId)) await removeDish(deps, u.ctx, d.dishId);
  return u;
}

describe('料理の保存の検証（BR3.1〜BR3.6）', () => {
  it('URL と料理名だけで保存できる。ほかの項目は空のまま', async () => {
    const u = await registerWithHousehold(deps, 'min');
    const d = await createDish(deps, u.ctx, dish());
    expect(d).toMatchObject({
      cookTime: null,
      effort: null,
      moodTags: [],
      ingredients: [],
      memo: null,
    });
    expect(d.createdBy).toBe(u.memberId);
  });

  it.each([
    ['URL が http/https 以外', { url: 'javascript:alert(1)' }, 'url'],
    ['URL が空', { url: '' }, 'url'],
    ['URL が 2000 文字超', { url: `https://example.com/${'a'.repeat(2000)}` }, 'url'],
    ['料理名が空', { name: '  ' }, 'name'],
    ['料理名が 100 文字超', { name: 'あ'.repeat(101) }, 'name'],
    ['タグが 6 個', { moodTags: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'moodTags'],
    ['タグが 21 文字', { moodTags: ['あ'.repeat(21)] }, 'moodTags.0'],
    ['タグが重複', { moodTags: ['a', 'a'] }, 'moodTags'],
    ['調理時間が選択肢以外', { cookTime: 'forever' }, 'cookTime'],
    ['手間が選択肢以外', { effort: 'impossible' }, 'effort'],
    ['材料名が空', { ingredients: [{ name: '', amount: '1', unit: '個' }] }, 'ingredients.0.name'],
    [
      '分量が 31 文字',
      { ingredients: [{ name: 'x', amount: 'あ'.repeat(31) }] },
      'ingredients.0.amount',
    ],
    ['メモが 1001 文字', { memo: 'あ'.repeat(1001) }, 'memo'],
  ])('保存できない：%s', async (_label, over, field) => {
    const u = await registerWithHousehold(deps, 'inval');
    await expect(createDish(deps, u.ctx, dish(over))).rejects.toMatchObject({
      code: 'validation',
      fields: { [field]: expect.any(String) },
    });
  });

  it('上限ちょうどの入力は保存できる（タグ 5 個・20 文字、料理名 100 文字）', async () => {
    const u = await registerWithHousehold(deps, 'max');
    const d = await createDish(
      deps,
      u.ctx,
      dish({
        name: 'あ'.repeat(100),
        moodTags: ['い'.repeat(20), 'b', 'c', 'd', 'e'],
        cookTime: 'over30',
        effort: 'hard',
        ingredients: [{ name: '玉ねぎ', amount: '1', unit: '個' }],
        memo: 'メ'.repeat(1000),
      }),
    );
    expect(d.moodTags).toHaveLength(5);
  });
});

describe('重複 URL の確認（BR3.7）', () => {
  it('同じ URL があれば保存せず、既存の料理名を示す。確認すれば保存できる', async () => {
    const u = await registerWithHousehold(deps, 'dup');
    const first = await createDish(deps, u.ctx, dish());
    await expect(createDish(deps, u.ctx, dish({ name: '別名' }))).rejects.toMatchObject({
      code: 'duplicate_url',
      data: { existing: { dishId: first.dishId, name: '麻婆なす' } },
    });
    const second = await createDish(deps, u.ctx, dish({ name: '別名' }), {
      confirmDuplicate: true,
    });
    expect(second.dishId).not.toBe(first.dishId);
  });

  it('末尾のスラッシュが違えば別の URL。初期データのダミー URL は対象外', async () => {
    const u = await registerWithHousehold(deps, 'dup2');
    await createDish(deps, u.ctx, dish());
    await expect(
      createDish(deps, u.ctx, dish({ url: 'https://example.com/mapo/' })),
    ).resolves.toBeTruthy();
    await expect(
      createDish(deps, u.ctx, dish({ url: 'https://example.com/seed/gyoza' })),
    ).resolves.toBeTruthy();
  });

  it('削除済みの料理の URL は重複にならない', async () => {
    const u = await registerWithHousehold(deps, 'dup3');
    const d = await createDish(deps, u.ctx, dish());
    await removeDish(deps, u.ctx, d.dishId);
    await expect(createDish(deps, u.ctx, dish())).resolves.toBeTruthy();
  });
});

describe('編集・削除・お気に入り（BR3.8〜BR3.11、BR2.4）', () => {
  it('編集できる。他のグループの料理は見つからない', async () => {
    const a = await registerWithHousehold(deps, 'edA');
    const b = await registerWithHousehold(deps, 'edB');
    const d = await createDish(deps, a.ctx, dish());
    const edited = await editDish(
      deps,
      a.ctx,
      d.dishId,
      dish({ name: '改名', cookTime: 'within15' }),
    );
    expect(edited).toMatchObject({ name: '改名', cookTime: 'within15' });
    await expect(editDish(deps, b.ctx, d.dishId, dish())).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(removeDish(deps, b.ctx, d.dishId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(markFavorite(deps, b.ctx, d.dishId, true)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(findDish(deps, b.ctx, d.dishId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('編集の検証は保存と同じ。初期データも編集・削除できる', async () => {
    const u = await registerWithHousehold(deps, 'edseed');
    const [seed] = await listDishes(deps.db, u.householdId);
    await expect(editDish(deps, u.ctx, seed.dishId, dish({ url: 'nope' }))).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(
      editDish(deps, u.ctx, seed.dishId, dish({ name: '自家製' })),
    ).resolves.toBeTruthy();
    await removeDish(deps, u.ctx, seed.dishId);
  });

  it('編集の途中で失敗しても、料理本体も材料も元のまま（1 つの取引）', async () => {
    const u = await registerWithHousehold(deps, 'txfail');
    const before = await createDish(
      deps,
      u.ctx,
      dish({ url: 'https://example.com/tx', ingredients: [{ name: '元の材料', amount: '1' }] }),
    );
    // 材料の書き込みだけ失敗する DB に差し替える
    const failing: AppDeps = {
      ...deps,
      db: {
        ...deps.db,
        transaction: (fn) =>
          deps.db.transaction((tx) =>
            fn({
              exec: (sql) => tx.exec(sql),
              query: (sql, params) =>
                sql.includes('insert into dish_ingredients')
                  ? Promise.reject(new Error('boom'))
                  : tx.query(sql, params),
            }),
          ),
      },
    };
    await expect(
      editDish(
        failing,
        u.ctx,
        before.dishId,
        dish({ name: '壊れる編集', url: 'https://example.com/tx', ingredients: [{ name: '新' }] }),
      ),
    ).rejects.toThrow('boom');
    const after = await findDish(deps, u.ctx, before.dishId);
    expect(after.name).toBe(before.name);
    expect(after.ingredients).toEqual(before.ingredients);
  });

  it('同時に編集しても失敗せず、材料は片方の編集の内容だけが残る', async () => {
    const u = await registerWithHousehold(deps, 'txconc');
    const d = await createDish(deps, u.ctx, dish({ url: 'https://example.com/conc' }));
    const variants = [1, 2, 3, 4, 5].map((n) => ({
      name: `同時編集${n}`,
      ingredients: [
        { name: `材料${n}-a`, amount: null, unit: null },
        { name: `材料${n}-b`, amount: null, unit: null },
      ],
    }));
    const results = await Promise.allSettled(
      variants.map((v) => editDish(deps, u.ctx, d.dishId, dish({ ...v, url: d.url }))),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const final = await findDish(deps, u.ctx, d.dishId);
    const winner = variants.find((v) => v.name === final.name);
    expect(winner).toBeDefined();
    expect(final.ingredients).toEqual(winner!.ingredients);
  });

  it('削除は論理削除。一覧に出ず、繰り返すと見つからない', async () => {
    const u = await registerWithHousehold(deps, 'del');
    const d = await createDish(deps, u.ctx, dish());
    await removeDish(deps, u.ctx, d.dishId);
    expect((await listHouseholdDishes(deps, u.ctx)).some((x) => x.dishId === d.dishId)).toBe(false);
    const row = await deps.db.query<{ deleted_at: Date | null }>(
      'select deleted_at from dishes where dish_id = $1',
      [d.dishId],
    );
    expect(row.rows[0].deleted_at).not.toBeNull();
    await expect(removeDish(deps, u.ctx, d.dishId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('お気に入りはグループで共有。同じ操作を繰り返しても同じ', async () => {
    const u = await registerWithHousehold(deps, 'fav');
    const d = await createDish(deps, u.ctx, dish());
    await markFavorite(deps, u.ctx, d.dishId, true);
    await markFavorite(deps, u.ctx, d.dishId, true);
    const favs = await listHouseholdDishes(deps, u.ctx, { favoriteOnly: true });
    expect(favs.map((x) => x.dishId)).toEqual([d.dishId]);
    await markFavorite(deps, u.ctx, d.dishId, false);
    expect(await listHouseholdDishes(deps, u.ctx, { favoriteOnly: true })).toEqual([]);
  });
});

describe('候補（BR4.1〜BR4.11）', () => {
  it('保存が 0 件なら「empty」', async () => {
    const u = await emptyHousehold('c0');
    expect(await nextCandidate(deps, u.householdId)).toEqual({ status: 'empty' });
  });

  it('乱数を固定すると決まった順で出て、見た料理は再び出ない。全部見ると done', async () => {
    const u = await emptyHousehold('c1');
    const a = await createDish(deps, u.ctx, dish({ url: 'https://e.com/a', name: 'A' }));
    const b = await createDish(deps, u.ctx, dish({ url: 'https://e.com/b', name: 'B' }));
    const c = await createDish(deps, u.ctx, dish({ url: 'https://e.com/c', name: 'C' }));
    const ids = [a.dishId, b.dishId, c.dishId].sort();
    rand = 0;
    const first = await nextCandidate(deps, u.householdId);
    expect(first).toMatchObject({ status: 'card', remaining: 2 });
    if (first.status !== 'card') throw new Error('unreachable');
    expect(first.dish.dishId).toBe(ids[0]);
    const seen = [first.dish.dishId];
    rand = 0.99;
    const second = await nextCandidate(deps, u.householdId, seen);
    if (second.status !== 'card') throw new Error('unreachable');
    expect(second.dish.dishId).toBe(ids[2]);
    seen.push(second.dish.dishId);
    const third = await nextCandidate(deps, u.householdId, seen);
    if (third.status !== 'card') throw new Error('unreachable');
    expect(third.dish.dishId).toBe(ids[1]);
    seen.push(third.dish.dishId);
    expect(await nextCandidate(deps, u.householdId, seen)).toEqual({ status: 'done' });
    // 「最初から見る」＝ 見た一覧を空にする
    expect((await nextCandidate(deps, u.householdId, [])).status).toBe('card');
  });

  it('「選んだもの」と削除済みは候補に出ない。外すと戻る', async () => {
    const u = await emptyHousehold('c2');
    const a = await createDish(deps, u.ctx, dish({ url: 'https://e.com/a', name: 'A' }));
    const b = await createDish(deps, u.ctx, dish({ url: 'https://e.com/b', name: 'B' }));
    await pick(deps, u.ctx, a.dishId);
    for (const r of [0, 0.5, 0.99]) {
      rand = r;
      const n = await nextCandidate(deps, u.householdId);
      expect(n.status === 'card' && n.dish.dishId).toBe(b.dishId);
    }
    await removeDish(deps, u.ctx, b.dishId);
    expect(await nextCandidate(deps, u.householdId)).toEqual({ status: 'done' });
    await unpick(deps, u.ctx, a.dishId);
    const back = await nextCandidate(deps, u.householdId);
    expect(back.status === 'card' && back.dish.dishId).toBe(a.dishId);
  });

  it('材料が未入力の料理は、候補で ingredients が空として返る（BR4.8）', async () => {
    const u = await emptyHousehold('c3');
    await createDish(deps, u.ctx, dish());
    const n = await nextCandidate(deps, u.householdId);
    expect(n.status === 'card' && n.dish.ingredients).toEqual([]);
  });

  it('「これにする」は二重でも 1 件。同時でも 1 件。他のグループの料理は見つからない', async () => {
    const a = await registerWithHousehold(deps, 'pk-a');
    const b = await registerWithHousehold(deps, 'pk-b');
    const d = await createDish(deps, a.ctx, dish());
    await Promise.all([
      pick(deps, a.ctx, d.dishId),
      pick(deps, a.ctx, d.dishId),
      pick(deps, a.ctx, d.dishId),
    ]);
    expect(await pickedList(deps, a.ctx)).toHaveLength(1);
    await expect(pick(deps, b.ctx, d.dishId)).rejects.toMatchObject({ code: 'not_found' });
    await removeDish(deps, a.ctx, d.dishId);
    expect(await pickedList(deps, a.ctx)).toHaveLength(0);
    await unpick(deps, a.ctx, d.dishId);
  });

  it('初期データも保存した料理も区別なく候補になる（BR4.1）', async () => {
    const u = await registerWithHousehold(deps, 'c4');
    const seen: string[] = [];
    let count = 0;
    for (;;) {
      rand = (count * 0.37) % 1;
      const n = await nextCandidate(deps, u.householdId, seen);
      if (n.status !== 'card') break;
      seen.push(n.dish.dishId);
      count += 1;
    }
    expect(count).toBe(30);
    expect(new Set(seen).size).toBe(30);
  });
});
