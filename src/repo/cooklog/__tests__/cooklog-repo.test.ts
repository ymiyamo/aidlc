import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDish } from '@/domain/dish';
import type { AppDeps } from '@/domain/deps';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import {
  deleteRecord,
  deleteRecordsOfHousehold,
  getDishNames,
  getMemberLabels,
  getRecord,
  insertRecord,
  latestImpressionRows,
  listRecordsBetween,
  listRecordsByDish,
  updateRecord,
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
    url: 'https://example.com/a',
  });
  return { ...u, dish };
}

const add = (
  w: { householdId: string; memberId: string },
  dishId: string,
  cookedOn: string,
  impression: 'again' | 'never_again' | null = null,
) =>
  insertRecord(deps.db, w.householdId, {
    recordId: crypto.randomUUID(),
    dishId,
    memberId: w.memberId,
    cookedOn,
    impression,
    cautionMemo: null,
    now: NOW,
  });

describe('リポジトリ：追加・取得', () => {
  it('追加すると、日付は文字列のまま読める（時差でずれない）', async () => {
    const w = await world('a');
    const id = crypto.randomUUID();
    const r = await insertRecord(deps.db, w.householdId, {
      recordId: id,
      dishId: w.dish.dishId,
      memberId: w.memberId,
      cookedOn: '2026-10-01',
      impression: 'again',
      cautionMemo: '焦がさない',
      now: NOW,
    });
    expect(r).toEqual({ created: true });
    const row = await getRecord(deps.db, w.householdId, id);
    expect(row).toMatchObject({
      cookedOn: '2026-10-01',
      impression: 'again',
      cautionMemo: '焦がさない',
      dishId: w.dish.dishId,
    });
  });

  it('同じ料理の同じ日は作らず、既存の recordId を返す', async () => {
    const w = await world('dup');
    await add(w, w.dish.dishId, '2026-10-01');
    const first = (await listRecordsByDish(deps.db, w.householdId, w.dish.dishId))[0];
    const r = await add(w, w.dish.dishId, '2026-10-01');
    expect(r).toEqual({ created: false, existingRecordId: first.recordId });
    expect(await listRecordsByDish(deps.db, w.householdId, w.dish.dishId)).toHaveLength(1);
  });

  it('同時に 2 件の追加が来ても 1 件になる（BR40.4）', async () => {
    const w = await world('race');
    const results = await Promise.all([
      add(w, w.dish.dishId, '2026-10-05'),
      add(w, w.dish.dishId, '2026-10-05'),
    ]);
    expect(results.filter((x) => x.created)).toHaveLength(1);
    expect(await listRecordsByDish(deps.db, w.householdId, w.dish.dishId)).toHaveLength(1);
  });
});

describe('リポジトリ：グループの範囲（ADR-005）', () => {
  it('他のグループの記録は、取得・更新・削除のどれでも見えない', async () => {
    const a = await world('ga');
    const b = await world('gb');
    await add(a, a.dish.dishId, '2026-10-01');
    const rec = (await listRecordsByDish(deps.db, a.householdId, a.dish.dishId))[0];

    expect(await getRecord(deps.db, b.householdId, rec.recordId)).toBeNull();
    expect(
      await updateRecord(deps.db, b.householdId, rec.recordId, {
        cookedOn: '2026-10-02',
        impression: null,
        cautionMemo: null,
        now: NOW,
      }),
    ).toBe('not_found');
    expect(await deleteRecord(deps.db, b.householdId, rec.recordId)).toBe(false);
    expect(await listRecordsBetween(deps.db, b.householdId, '2026-01-01', '2026-12-31')).toEqual(
      [],
    );
    expect(await getRecord(deps.db, a.householdId, rec.recordId)).not.toBeNull();
  });

  it('料理名・メンバーの取得も、他のグループのものは返さない', async () => {
    const a = await world('na');
    const b = await world('nb');
    expect((await getDishNames(deps.db, b.householdId, [a.dish.dishId])).size).toBe(0);
    expect((await getMemberLabels(deps.db, b.householdId, [a.memberId])).size).toBe(0);
    expect(
      (await getDishNames(deps.db, a.householdId, [a.dish.dishId])).get(a.dish.dishId),
    ).toEqual({
      name: 'naの料理',
      deleted: false,
    });
  });

  it('グループの記録をすべて消す。何度やっても同じで、他のグループには触れない', async () => {
    const a = await world('da');
    const b = await world('db');
    await add(a, a.dish.dishId, '2026-10-01');
    await add(b, b.dish.dishId, '2026-10-01');
    expect(await deleteRecordsOfHousehold(deps.db, a.householdId)).toBe(1);
    expect(await deleteRecordsOfHousehold(deps.db, a.householdId)).toBe(0);
    expect(
      await listRecordsBetween(deps.db, b.householdId, '2026-10-01', '2026-10-31'),
    ).toHaveLength(1);
  });
});

describe('リポジトリ：日付の範囲と並び', () => {
  it('範囲は両端を含み、作った日の新しい順に返す', async () => {
    const w = await world('range');
    for (const d of ['2026-09-30', '2026-10-01', '2026-10-15', '2026-10-31', '2026-11-01']) {
      await add(w, w.dish.dishId, d);
    }
    const rows = await listRecordsBetween(deps.db, w.householdId, '2026-10-01', '2026-10-31');
    expect(rows.map((r) => r.cookedOn)).toEqual(['2026-10-31', '2026-10-15', '2026-10-01']);
  });
});

describe('リポジトリ：更新・削除', () => {
  it('置き換えるのは日付・感想・メモだけ。料理と記録した人は変わらない', async () => {
    const w = await world('upd');
    await add(w, w.dish.dishId, '2026-10-01', 'again');
    const rec = (await listRecordsByDish(deps.db, w.householdId, w.dish.dishId))[0];
    const later = new Date('2026-10-11T00:00:00Z');
    expect(
      await updateRecord(deps.db, w.householdId, rec.recordId, {
        cookedOn: '2026-10-03',
        impression: null,
        cautionMemo: 'メモ',
        now: later,
      }),
    ).toBe('updated');
    const after = (await getRecord(deps.db, w.householdId, rec.recordId))!;
    expect(after).toMatchObject({ cookedOn: '2026-10-03', impression: null, cautionMemo: 'メモ' });
    expect(after.dishId).toBe(rec.dishId);
    expect(after.memberId).toBe(rec.memberId);
    expect(after.createdAt).toEqual(rec.createdAt);
    expect(after.updatedAt).toEqual(later);
  });

  it('日付を変えて同じ料理の別の記録とぶつかるときは duplicate', async () => {
    const w = await world('upd2');
    await add(w, w.dish.dishId, '2026-10-01');
    await add(w, w.dish.dishId, '2026-10-02');
    const rec = (await listRecordsByDish(deps.db, w.householdId, w.dish.dishId)).find(
      (r) => r.cookedOn === '2026-10-02',
    )!;
    expect(
      await updateRecord(deps.db, w.householdId, rec.recordId, {
        cookedOn: '2026-10-01',
        impression: null,
        cautionMemo: null,
        now: NOW,
      }),
    ).toBe('duplicate');
  });

  it('削除は 1 件だけ。重ねて削除しても結果は同じ（false になるだけ）', async () => {
    const w = await world('del');
    await add(w, w.dish.dishId, '2026-10-01');
    await add(w, w.dish.dishId, '2026-10-02');
    const [first, second] = await listRecordsByDish(deps.db, w.householdId, w.dish.dishId);
    expect(await deleteRecord(deps.db, w.householdId, first.recordId)).toBe(true);
    expect(await deleteRecord(deps.db, w.householdId, first.recordId)).toBe(false);
    expect(await getRecord(deps.db, w.householdId, second.recordId)).not.toBeNull();
  });
});

describe('リポジトリ：最新の感想（BR40.19）', () => {
  it('作った日が最も新しい 1 件の感想を返す。以前の感想にはさかのぼらない', async () => {
    const w = await world('lat');
    await add(w, w.dish.dishId, '2026-10-01', 'never_again');
    await add(w, w.dish.dishId, '2026-10-05', 'again');
    const m = await latestImpressionRows(deps.db, w.householdId, [w.dish.dishId]);
    expect(m.get(w.dish.dishId)).toBe('again');
    await add(w, w.dish.dishId, '2026-10-09', null);
    expect(
      (await latestImpressionRows(deps.db, w.householdId, [w.dish.dishId])).get(w.dish.dishId),
    ).toBeNull();
  });

  it('記録のない料理・空の一覧・他のグループは含まれない', async () => {
    const a = await world('la');
    const b = await world('lb');
    await add(a, a.dish.dishId, '2026-10-01', 'never_again');
    expect((await latestImpressionRows(deps.db, a.householdId, [])).size).toBe(0);
    expect((await latestImpressionRows(deps.db, b.householdId, [a.dish.dishId])).size).toBe(0);
    expect((await latestImpressionRows(deps.db, a.householdId, [b.dish.dishId])).size).toBe(0);
  });
});
