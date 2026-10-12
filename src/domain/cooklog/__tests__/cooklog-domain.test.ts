import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from '@/domain/deps';
import { createDish, removeDish } from '@/domain/dish';
import { DomainError } from '@/domain/errors';
import { nextCandidate, setImpressionJudge } from '@/domain/suggestion';
import { listDishes } from '@/repo/dishes';
import { createTestDeps, registerWithHousehold, type TestClock } from '@/test-helpers/deps';
import {
  addRecord,
  dishRecords,
  editRecord,
  ensureCookLogHandlers,
  latestImpressionsByDish,
  monthView,
  removeRecord,
  shortName,
} from '../index';
import { currentMonthJst, isRealDate, monthRange, todayJst } from '../dates';

let deps: AppDeps;
let clock: TestClock;
beforeAll(async () => {
  ({ deps, clock } = await createTestDeps({ random: () => 0 }));
  // 2026-10-10 12:00（日本時間 21:00）
  clock.current = new Date('2026-10-10T12:00:00Z');
});
afterAll(async () => {
  await deps.db.close();
});

/** 初期データなしの空のグループに、料理を name の数だけ作る */
async function world(label: string, dishNames: string[] = ['親子丼']) {
  const u = await registerWithHousehold(deps, label);
  for (const d of await listDishes(deps.db, u.householdId)) await removeDish(deps, u.ctx, d.dishId);
  const dishes = [];
  for (const [i, name] of dishNames.entries()) {
    dishes.push(await createDish(deps, u.ctx, { name, url: `https://example.com/${label}-${i}` }));
  }
  return { ...u, dishes, dish: dishes[0] };
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as DomainError;
  }
  throw new Error('失敗するはずが成功した');
};

describe('日付（BR40.22）', () => {
  it('今日は日本時間で決まる（UTC の 15:00 で日付が変わる）', () => {
    expect(todayJst(new Date('2026-10-10T14:59:59Z'))).toBe('2026-10-10');
    expect(todayJst(new Date('2026-10-10T15:00:00Z'))).toBe('2026-10-11');
    expect(currentMonthJst(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10');
  });

  it('実在しない日付・月は受け付けない', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2024-02-29')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-1-1')).toBe(false);
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('abc')).toBeNull();
  });
});

describe('追加（BR40.1〜BR40.6）', () => {
  it('同じ料理に、別の日の記録を何件でも追加できる（1 対多）', async () => {
    const w = await world('multi');
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-09']) {
      await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: d });
    }
    const r = await dishRecords(deps, w.ctx, w.dish.dishId);
    expect(r.count).toBe(3);
    expect(r.records.map((x) => x.cookedOn)).toEqual(['2026-10-09', '2026-10-02', '2026-10-01']);
  });

  it('感想とメモは任意。空白だけのメモは空として扱う', async () => {
    const w = await world('opt');
    const a = await addRecord(deps, w.ctx, {
      dishId: w.dish.dishId,
      cookedOn: '2026-10-01',
      impression: '',
      cautionMemo: '   ',
    });
    expect(a).toMatchObject({ impression: null, cautionMemo: null });
    const b = await addRecord(deps, w.ctx, {
      dishId: w.dish.dishId,
      cookedOn: '2026-10-02',
      impression: 'never_again',
      cautionMemo: ' 焦げやすい ',
    });
    expect(b).toMatchObject({ impression: 'never_again', cautionMemo: '焦げやすい' });
    expect(b.memberLabel).toBe('opt');
  });

  it('同じ料理の同じ日は、DUPLICATE_RECORD と既存の recordId を返す（BR40.4）', async () => {
    const w = await world('dup');
    const first = await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' });
    const err = await failure(
      addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' }),
    );
    expect(err.code).toBe('conflict');
    expect(err.data).toMatchObject({ code: 'DUPLICATE_RECORD', existingRecordId: first.recordId });
    expect((await dishRecords(deps, w.ctx, w.dish.dishId)).count).toBe(1);
  });

  it('違う料理なら、同じ日に何件でも追加できる', async () => {
    const w = await world('sameday', ['A', 'B', 'C']);
    for (const d of w.dishes)
      await addRecord(deps, w.ctx, { dishId: d.dishId, cookedOn: '2026-10-05' });
    const m = await monthView(deps, w.ctx, '2026-10');
    expect(m.records).toHaveLength(3);
  });

  it('未来の日付は断る（今日は可）。日本時間で判定する（BR40.1）', async () => {
    const w = await world('future');
    const err = await failure(
      addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-11' }),
    );
    expect(err.code).toBe('validation');
    expect(err.data).toMatchObject({ code: 'FUTURE_DATE_NOT_ALLOWED' });
    expect(err.fields).toEqual({ cookedOn: '未来の日付は選べません' });
    await expect(
      addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-10' }),
    ).resolves.toBeDefined();
    // UTC ではまだ 10/10 だが、日本時間では 10/11 になる
    clock.current = new Date('2026-10-10T15:30:00Z');
    await expect(
      addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-11' }),
    ).resolves.toBeDefined();
    clock.current = new Date('2026-10-10T12:00:00Z');
  });

  it.each([
    ['作った日が空', { cookedOn: '' }, 'cookedOn'],
    ['実在しない日', { cookedOn: '2026-02-30' }, 'cookedOn'],
    ['感想が 2 択以外', { cookedOn: '2026-10-01', impression: 'maybe' }, 'impression'],
    ['メモが 1001 文字', { cookedOn: '2026-10-01', cautionMemo: 'あ'.repeat(1001) }, 'cautionMemo'],
  ])('入力エラー：%s', async (_n, over, field) => {
    const w = await world('inv');
    const err = await failure(addRecord(deps, w.ctx, { dishId: w.dish.dishId, ...over }));
    expect(err.code).toBe('validation');
    expect(err.fields).toHaveProperty(field);
  });

  it('他のグループの料理・存在しない料理・形の違う ID は「見つからない」（BR40.5）', async () => {
    const a = await world('own');
    const b = await world('other');
    for (const dishId of [b.dish.dishId, crypto.randomUUID(), 'not-a-uuid']) {
      const err = await failure(addRecord(deps, a.ctx, { dishId, cookedOn: '2026-10-01' }));
      expect(err.code).toBe('not_found');
    }
  });

  it('削除済みの料理には追加できないが、既存の記録は残り、「削除済み」と分かる（BR40.11）', async () => {
    const w = await world('del');
    await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' });
    await removeDish(deps, w.ctx, w.dish.dishId);
    const err = await failure(
      addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-02' }),
    );
    expect(err.code).toBe('not_found');
    const m = await monthView(deps, w.ctx, '2026-10');
    expect(m.records).toHaveLength(1);
    expect(m.records[0]).toMatchObject({ dishName: '親子丼', dishDeleted: true });
    // 既存の記録は編集・削除できる
    await expect(
      editRecord(deps, w.ctx, m.records[0].recordId, {
        cookedOn: '2026-10-03',
        impression: 'again',
      }),
    ).resolves.toBeDefined();
    await expect(removeRecord(deps, w.ctx, m.records[0].recordId)).resolves.toBeUndefined();
  });
});

describe('編集・削除（BR40.8〜BR40.10）', () => {
  it('作った日・感想・メモを置き換える。感想を外すこともできる', async () => {
    const w = await world('edit');
    const r = await addRecord(deps, w.ctx, {
      dishId: w.dish.dishId,
      cookedOn: '2026-10-01',
      impression: 'again',
    });
    const e = await editRecord(deps, w.ctx, r.recordId, {
      cookedOn: '2026-10-02',
      impression: '',
      cautionMemo: '弱火で',
    });
    expect(e).toMatchObject({
      recordId: r.recordId,
      dishId: r.dishId,
      cookedOn: '2026-10-02',
      impression: null,
      cautionMemo: '弱火で',
    });
    // 同じ内容でもう一度保存しても結果は同じ
    expect(
      await editRecord(deps, w.ctx, r.recordId, { cookedOn: '2026-10-02', cautionMemo: '弱火で' }),
    ).toMatchObject({ cookedOn: '2026-10-02' });
  });

  it('日付を変えて同じ料理の別の記録とぶつかるときは、DUPLICATE_RECORD', async () => {
    const w = await world('edit2');
    const a = await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' });
    const b = await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-02' });
    const err = await failure(editRecord(deps, w.ctx, b.recordId, { cookedOn: '2026-10-01' }));
    expect(err.data).toMatchObject({ code: 'DUPLICATE_RECORD', existingRecordId: a.recordId });
  });

  it('編集でも未来の日付は断る', async () => {
    const w = await world('edit3');
    const a = await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' });
    const err = await failure(editRecord(deps, w.ctx, a.recordId, { cookedOn: '2026-12-01' }));
    expect(err.data).toMatchObject({ code: 'FUTURE_DATE_NOT_ALLOWED' });
  });

  it('グループのメンバーなら、記録した人でなくても編集・削除できる', async () => {
    const w = await world('team');
    const a = await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' });
    const other = { householdId: w.householdId, memberId: crypto.randomUUID() };
    await expect(
      editRecord(deps, other, a.recordId, { cookedOn: '2026-10-02' }),
    ).resolves.toBeDefined();
    await expect(removeRecord(deps, other, a.recordId)).resolves.toBeUndefined();
  });

  it('他のグループの記録は、編集も削除も「見つからない」', async () => {
    const a = await world('ea');
    const b = await world('eb');
    const rec = await addRecord(deps, a.ctx, { dishId: a.dish.dishId, cookedOn: '2026-10-01' });
    expect(
      (await failure(editRecord(deps, b.ctx, rec.recordId, { cookedOn: '2026-10-02' }))).code,
    ).toBe('not_found');
    expect((await failure(removeRecord(deps, b.ctx, rec.recordId))).code).toBe('not_found');
    expect((await failure(dishRecords(deps, b.ctx, a.dish.dishId))).code).toBe('not_found');
    expect((await dishRecords(deps, a.ctx, a.dish.dishId)).count).toBe(1);
  });

  it('削除はその 1 件だけ。同じ料理の他の記録は残る', async () => {
    const w = await world('rm');
    const a = await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' });
    await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-02' });
    await removeRecord(deps, w.ctx, a.recordId);
    expect((await dishRecords(deps, w.ctx, w.dish.dishId)).records.map((r) => r.cookedOn)).toEqual([
      '2026-10-02',
    ]);
  });
});

describe('カレンダーと一覧（BR40.12、BR40.13、BR40.23）', () => {
  it('1 日に複数あるときは「ほか N 件」。料理名は 8 文字までで省く', async () => {
    const w = await world('cal', ['とても長い名前の料理が九文字', '短い料理', '三つ目']);
    const [long, short, third] = w.dishes;
    await addRecord(deps, w.ctx, { dishId: short.dishId, cookedOn: '2026-10-04' });
    clock.advanceMs(1000);
    await addRecord(deps, w.ctx, {
      dishId: long.dishId,
      cookedOn: '2026-10-04',
      impression: 'again',
    });
    await addRecord(deps, w.ctx, {
      dishId: third.dishId,
      cookedOn: '2026-10-06',
      impression: 'never_again',
    });
    const m = await monthView(deps, w.ctx, '2026-10');
    expect(m.days).toEqual([
      { date: '2026-10-04', count: 2, label: 'とても長い名前の… ほか1件', impression: 'again' },
      { date: '2026-10-06', count: 1, label: '三つ目', impression: 'never_again' },
    ]);
    expect(shortName('12345678')).toBe('12345678');
    expect(shortName('123456789')).toBe('12345678…');
    // 一覧は作った日の新しい順
    expect(m.records.map((r) => r.cookedOn)).toEqual(['2026-10-06', '2026-10-04', '2026-10-04']);
    clock.current = new Date('2026-10-10T12:00:00Z');
  });

  it('月の境目で分かれる。記録のない月・未来の月は空。月を省くと今月', async () => {
    const w = await world('month');
    await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-09-30' });
    await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' });
    expect((await monthView(deps, w.ctx, '2026-09')).records).toHaveLength(1);
    expect((await monthView(deps, w.ctx, '2026-10')).records).toHaveLength(1);
    expect((await monthView(deps, w.ctx, '2027-05')).records).toEqual([]);
    const now = await monthView(deps, w.ctx);
    expect(now).toMatchObject({ month: '2026-10', today: '2026-10-10' });
  });

  it('月の形が正しくなければ入力エラー', async () => {
    const w = await world('badmonth');
    for (const bad of ['2026-13', '202610', 'x']) {
      expect((await failure(monthView(deps, w.ctx, bad))).code).toBe('validation');
    }
  });

  it('他のグループの記録は混ざらない', async () => {
    const a = await world('ma');
    const b = await world('mb');
    await addRecord(deps, a.ctx, { dishId: a.dish.dishId, cookedOn: '2026-10-01' });
    expect((await monthView(deps, b.ctx, '2026-10')).records).toEqual([]);
  });

  it('抜けたメンバーの記録は残り、「退会したメンバー」と表示する', async () => {
    const w = await world('left');
    await addRecord(deps, w.ctx, { dishId: w.dish.dishId, cookedOn: '2026-10-01' });
    await deps.db.query('update members set left_at = now() where member_id = $1', [w.memberId]);
    const m = await monthView(deps, w.ctx, '2026-10');
    expect(m.records[0].memberLabel).toBe('退会したメンバー');
  });
});

describe('最新の感想と候補の並べ替え（BR40.19、BR40.20）', () => {
  it('作った日が最も新しい記録の感想になる。感想がなければ none。さかのぼらない', async () => {
    const w = await world('lat', ['A', 'B', 'C']);
    const [a, b, c] = w.dishes;
    await addRecord(deps, w.ctx, {
      dishId: a.dishId,
      cookedOn: '2026-10-01',
      impression: 'never_again',
    });
    await addRecord(deps, w.ctx, { dishId: a.dishId, cookedOn: '2026-10-05', impression: 'again' });
    await addRecord(deps, w.ctx, { dishId: b.dishId, cookedOn: '2026-10-01', impression: 'again' });
    await addRecord(deps, w.ctx, { dishId: b.dishId, cookedOn: '2026-10-06' });
    const m = await latestImpressionsByDish(deps, w.householdId, [a.dishId, b.dishId, c.dishId]);
    expect(Object.fromEntries(m)).toEqual({
      [a.dishId]: 'again',
      [b.dishId]: 'none',
      [c.dishId]: 'none',
    });
  });

  it('記録を追加・編集・削除すると、その結果が反映される', async () => {
    const w = await world('react');
    const r = await addRecord(deps, w.ctx, {
      dishId: w.dish.dishId,
      cookedOn: '2026-10-01',
      impression: 'never_again',
    });
    const get = async () =>
      (await latestImpressionsByDish(deps, w.householdId, [w.dish.dishId])).get(w.dish.dishId);
    expect(await get()).toBe('never_again');
    await editRecord(deps, w.ctx, r.recordId, { cookedOn: '2026-10-01', impression: 'again' });
    expect(await get()).toBe('again');
    await removeRecord(deps, w.ctx, r.recordId);
    expect(await get()).toBe('none');
  });

  /** 候補を最後まで 1 件ずつ取り出した料理名の順 */
  async function order(w: { householdId: string }) {
    const seen: string[] = [];
    const names: string[] = [];
    for (;;) {
      const next = await nextCandidate(deps, w.householdId, seen);
      if (next.status !== 'card') break;
      names.push(next.dish.name);
      seen.push(next.dish.dishId);
    }
    return names;
  }

  it('最新が「もう作りたくない」の料理は後ろ。候補からは外さない', async () => {
    const w = await world('order', ['A', 'B', 'C']);
    const before = await order(w);
    const target = w.dishes.find((d) => d.name === before[0])!;
    await addRecord(deps, w.ctx, {
      dishId: target.dishId,
      cookedOn: '2026-10-01',
      impression: 'never_again',
    });
    const after = await order(w);
    expect(after).toHaveLength(3);
    expect(after[2]).toBe(target.name);
  });

  it('最新が「また作りたい」なら、以前が「もう作りたくない」でも後ろにずれない', async () => {
    const w = await world('order2', ['A', 'B', 'C']);
    const before = await order(w);
    const target = w.dishes.find((d) => d.name === before[0])!;
    await addRecord(deps, w.ctx, {
      dishId: target.dishId,
      cookedOn: '2026-10-01',
      impression: 'never_again',
    });
    await addRecord(deps, w.ctx, {
      dishId: target.dishId,
      cookedOn: '2026-10-02',
      impression: 'again',
    });
    expect(await order(w)).toEqual(before);
  });

  it('全部が「もう作りたくない」でも、すべて出る', async () => {
    const w = await world('order3', ['A', 'B']);
    for (const d of w.dishes) {
      await addRecord(deps, w.ctx, {
        dishId: d.dishId,
        cookedOn: '2026-10-01',
        impression: 'never_again',
      });
    }
    expect((await order(w)).sort()).toEqual(['A', 'B']);
  });

  it('感想を聞けなかったときは、並べ替えをせず候補を出す', async () => {
    const w = await world('order4', ['A', 'B', 'C']);
    const before = await order(w);
    setImpressionJudge(async () => {
      throw new Error('boom');
    });
    try {
      expect(await order(w)).toEqual(before);
    } finally {
      setImpressionJudge(latestImpressionsByDish);
    }
  });
});

describe('グループの削除（BR40.21）', () => {
  it('household.deleted を受けたら、そのグループの記録を消す。他のグループは残り、何度受けても同じ', async () => {
    ensureCookLogHandlers(deps);
    ensureCookLogHandlers(deps); // 重ねて呼んでも 1 回だけ
    const a = await world('hd-a');
    const b = await world('hd-b');
    await addRecord(deps, a.ctx, { dishId: a.dish.dishId, cookedOn: '2026-10-01' });
    await addRecord(deps, b.ctx, { dishId: b.dish.dishId, cookedOn: '2026-10-01' });
    const ev = { eventId: crypto.randomUUID(), householdId: a.householdId };
    await deps.events.publish('household.deleted', ev);
    await deps.events.publish('household.deleted', ev);
    expect((await monthView(deps, a.ctx, '2026-10')).records).toEqual([]);
    expect((await monthView(deps, b.ctx, '2026-10')).records).toHaveLength(1);
  });
});
