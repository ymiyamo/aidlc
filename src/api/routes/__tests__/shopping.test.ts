import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { register } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { createDish } from '@/domain/dish';
import { pick, pickedList } from '@/domain/suggestion';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import { shoppingClient } from './shopping-harness';

let deps: AppDeps;
beforeAll(async () => {
  ({ deps } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

let seq = 0;

/** ログイン済みでグループもあるクライアントと、選んだ料理 1 件 */
async function member(label = 'm') {
  const h = await registerWithHousehold(deps, label);
  const dish = await createDish(deps, h.ctx, {
    name: '肉じゃが',
    url: `https://example.com/${label}/${(seq += 1)}`,
    ingredients: [
      { name: '玉ねぎ', amount: '2', unit: '個' },
      { name: '塩', amount: '少々', unit: null },
    ],
  });
  await pick(deps, h.ctx, dish.dishId);
  return { ...h, dish, api: shoppingClient(deps, h.session.token) };
}

const ITEM = (id: string) => `/api/shopping-list/items/${id}/checked`;

describe('入口：未ログイン・グループなし・CSRF', () => {
  const calls: [string, string, unknown][] = [
    ['GET', '/api/shopping-list', undefined],
    ['PUT', ITEM(crypto.randomUUID()), { checked: true }],
    ['POST', '/api/shopping-list/complete', {}],
  ];

  it('未ログインは 401', async () => {
    const anon = shoppingClient(deps);
    for (const [method, path, body] of calls) {
      expect((await anon.call(method, path, { body })).status, `${method} ${path}`).toBe(401);
    }
  });

  it('グループがない人は 403', async () => {
    const s = await register(deps, {
      email: 'loner-shopping@example.com',
      password: 'password-1234',
      displayName: 'l',
    });
    const loner = shoppingClient(deps, s.token);
    expect((await loner.get('/api/shopping-list')).status).toBe(403);
    expect((await loner.post('/api/shopping-list/complete')).status).toBe(403);
  });

  it('合言葉（CSRF）か Origin がない状態を変える操作は拒否され、何も変わらない', async () => {
    const m = await member('csrf');
    const list = (await m.api.get('/api/shopping-list')).body.list;
    const itemId = list.items[0].itemId;
    for (const opt of [{ csrf: false }, { origin: false }]) {
      expect(
        (await m.api.call('PUT', ITEM(itemId), { body: { checked: true }, ...opt })).status,
      ).toBe(403);
      expect(
        (await m.api.call('POST', '/api/shopping-list/complete', { body: {}, ...opt })).status,
      ).toBe(403);
    }
    const after = (await m.api.get('/api/shopping-list')).body.list;
    expect(after.status).toBe('active');
    expect(after.items.every((i: { checked: boolean }) => !i.checked)).toBe(true);
    expect((await pickedList(deps, m.ctx)).length).toBe(1);
  });

  it('許可されていないメソッド・存在しない道は 404', async () => {
    const m = await member('nf');
    expect((await m.api.call('DELETE', '/api/shopping-list')).status).toBe(404);
    expect((await m.api.get('/api/shopping-list/unknown')).status).toBe(404);
  });
});

describe('リストを開く（GET /api/shopping-list）', () => {
  it('選んだものの材料がまとまって返る。householdId は入力から受け取らない', async () => {
    const m = await member('open');
    const res = await m.api.get('/api/shopping-list');
    expect(res.status).toBe(200);
    expect(res.body.list).toMatchObject({
      source: 'picked',
      status: 'active',
      empty: false,
      stale: false,
    });
    expect(
      res.body.list.items
        .map(
          (i: { ingredientName: string; amountLabel: string; unit: string }) =>
            `${i.ingredientName}${i.amountLabel}${i.unit}`,
        )
        .sort(),
    ).toEqual(['塩少々', '玉ねぎ2個']);
    expect(res.body).not.toHaveProperty('staleMessage');
    // 別のグループの人には、自分のグループのリストが返る
    const other = await member('open-other');
    const theirs = (await other.api.get('/api/shopping-list?householdId=' + m.householdId)).body
      .list;
    expect(theirs.listId).not.toBe(res.body.list.listId);
  });

  it('選んだものがなければ空のリスト', async () => {
    const h = await registerWithHousehold(deps, 'nopick');
    const api = shoppingClient(deps, h.session.token);
    const res = await api.get('/api/shopping-list');
    expect(res.status).toBe(200);
    expect(res.body.list).toMatchObject({ empty: true, items: [] });
  });
});

describe('チェックの付け外し（PUT /api/shopping-list/items/:id/checked）', () => {
  it('付ける → 保存される → 外す。繰り返しても同じ', async () => {
    const m = await member('chk');
    const items = (await m.api.get('/api/shopping-list')).body.list.items;
    const onion = items.find((i: { ingredientName: string }) => i.ingredientName === '玉ねぎ');

    for (let n = 0; n < 2; n++) {
      const on = await m.api.put(ITEM(onion.itemId), { checked: true });
      expect(on.status).toBe(200);
      expect(on.body.item).toMatchObject({
        itemId: onion.itemId,
        checked: true,
        checkedByLabel: 'chk',
      });
    }
    const reopened = (await m.api.get('/api/shopping-list')).body.list.items;
    expect(reopened.find((i: { itemId: string }) => i.itemId === onion.itemId).checked).toBe(true);
    // チェックのある行は下に並ぶ
    expect(reopened[reopened.length - 1].itemId).toBe(onion.itemId);

    const off = await m.api.put(ITEM(onion.itemId), { checked: false });
    expect(off.body.item).toMatchObject({ checked: false, checkedByLabel: null });
  });

  it('異常系：他のグループの行は 404、不正な ID は 404、値の指定がなければ 400', async () => {
    const a = await member('chk-a');
    const b = await member('chk-b');
    const itemId = (await a.api.get('/api/shopping-list')).body.list.items[0].itemId;

    expect((await b.api.put(ITEM(itemId), { checked: true })).status).toBe(404);
    expect((await a.api.put(ITEM('not-a-uuid'), { checked: true })).status).toBe(404);
    expect((await a.api.put(ITEM(itemId), {})).status).toBe(400);
    expect((await a.api.put(ITEM(itemId), { checked: 'true' })).status).toBe(400);
    const after = (await a.api.get('/api/shopping-list')).body.list.items;
    expect(after.every((i: { checked: boolean }) => !i.checked)).toBe(true);
  });

  it('「材料の入力が必要」の行は 409 で「チェックできません」', async () => {
    const h = await registerWithHousehold(deps, 'needs');
    const dish = await createDish(deps, h.ctx, {
      name: '冷奴',
      url: `https://example.com/needs/${(seq += 1)}`,
    });
    await pick(deps, h.ctx, dish.dishId);
    const api = shoppingClient(deps, h.session.token);
    const row = (await api.get('/api/shopping-list')).body.list.items[0];
    expect(row.kind).toBe('needsInput');
    const res = await api.put(ITEM(row.itemId), { checked: true });
    expect(res.status).toBe(409);
    // 詳細の code が応答の code になる（U5 の DUPLICATE_RECORD と同じ扱い）
    expect(res.body.error).toMatchObject({
      code: 'NEEDS_INPUT_NOT_CHECKABLE',
      message: 'チェックできません',
    });
  });
});

describe('買い物おわり（POST /api/shopping-list/complete）', () => {
  it('完了し、選んだものが外れる。完了したリストの行へのチェックは 409。繰り返しても成功', async () => {
    const m = await member('fin');
    const list = (await m.api.get('/api/shopping-list')).body.list;
    const itemId = list.items[0].itemId;

    const done = await m.api.post('/api/shopping-list/complete');
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ alreadyCompleted: false, unpickPending: false });
    expect(await pickedList(deps, m.ctx)).toEqual([]);

    const checked = await m.api.put(ITEM(itemId), { checked: true });
    expect(checked.status).toBe(409);
    expect(checked.body.error.message).toBe('チェックできません');

    const again = await m.api.post('/api/shopping-list/complete');
    expect(again.status).toBe(200);
    expect(again.body.alreadyCompleted).toBe(true);

    const next = (await m.api.get('/api/shopping-list')).body.list;
    expect(next.listId).not.toBe(list.listId);
    expect(next).toMatchObject({ status: 'active', empty: true });
  });

  it('他のグループの人が完了しても、自分のグループのリストは変わらない', async () => {
    const a = await member('fin-a');
    const b = await member('fin-b');
    await a.api.get('/api/shopping-list');
    await b.api.post('/api/shopping-list/complete');
    expect((await pickedList(deps, a.ctx)).length).toBe(1);
    expect((await a.api.get('/api/shopping-list')).body.list.status).toBe('active');
  });
});

describe('グループ削除の受け口は最初の呼び出しで登録される（BR20.15）', () => {
  it('household.deleted を受けると、そのグループのリストが消える', async () => {
    const m = await member('gone');
    await m.api.get('/api/shopping-list');
    await deps.events.publish('household.deleted', {
      eventId: crypto.randomUUID(),
      householdId: m.householdId,
    });
    const r = await deps.db.query('select 1 from shopping_lists where household_id = $1', [
      m.householdId,
    ]);
    expect(r.rowCount).toBe(0);
  });
});
