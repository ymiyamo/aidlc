import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listDishes } from '@/repo/dishes';
import { createTestDeps, registerWithHousehold } from '@/test-helpers/deps';
import type { AppDeps } from '../deps';
import { removeDish } from '../dish';
import { prepareHome } from '../household';
import { ensureSeeds, loadSeedFile, parseSeedFile } from '../seed';

let deps: AppDeps;
beforeAll(async () => {
  ({ deps } = await createTestDeps());
});
afterAll(async () => {
  await deps.db.close();
});

describe('初期データのファイル（BR3.12、BR3.1〜BR3.5）', () => {
  it('30 件あり、seedKey が重複せず、すべて検証を通る', async () => {
    const file = await loadSeedFile();
    expect(file.dishes).toHaveLength(30);
    expect(new Set(file.dishes.map((d) => d.seedKey)).size).toBe(30);
    for (const d of file.dishes) {
      expect(d.url).toBe(`https://example.com/seed/${d.seedKey}`);
      expect(d.moodTags.length).toBeLessThanOrEqual(5);
      expect(d.ingredients.length).toBeGreaterThan(0);
      expect(d.cookTime).not.toBeNull();
      expect(d.effort).not.toBeNull();
    }
  });

  it('件数が 30 でない、または項目が不正なら読み込みに失敗する', async () => {
    const file = await loadSeedFile();
    expect(() => parseSeedFile({ dishes: file.dishes.slice(0, 29) })).toThrow();
    expect(() =>
      parseSeedFile({
        dishes: [...file.dishes.slice(0, 29), { ...file.dishes[0], url: 'ftp://x' }],
      }),
    ).toThrow();
    const dup = [...file.dishes.slice(0, 29), { ...file.dishes[0] }];
    expect(() => parseSeedFile({ dishes: dup })).toThrow(/重複/);
  });
});

describe('初期データの登録（冪等）', () => {
  it('同じ出来事を 2 回受けても 30 件のまま', async () => {
    const u = await registerWithHousehold(deps, 'seed');
    expect(await listDishes(deps.db, u.householdId)).toHaveLength(30);
    await deps.events.publish('household.created', { householdId: u.householdId });
    await deps.events.publish('household.created', { householdId: u.householdId });
    expect(await listDishes(deps.db, u.householdId)).toHaveLength(30);
  });

  it('削除した初期データは、ホームを開いた補完で復活しない', async () => {
    const u = await registerWithHousehold(deps, 'seeddel');
    const [first] = await listDishes(deps.db, u.householdId);
    await removeDish(deps, u.ctx, first.dishId);
    const home = await prepareHome(deps, u.householdId);
    expect(home.seedStatus).toBe('ready');
    expect(await listDishes(deps.db, u.householdId)).toHaveLength(29);
  });

  it('出来事が届かなかったグループは、ホームを開いたときに 30 件そろう', async () => {
    const { deps: d2 } = await createTestDeps({ loadSeed: async () => ({ dishes: [] }) });
    // 受け手が何も登録しなかった状態（出来事が届かなかった場合）を作る
    const u = await registerWithHousehold(d2, 'late');
    expect(await listDishes(d2.db, u.householdId)).toHaveLength(0);
    d2.loadSeed = loadSeedFile;
    const home = await prepareHome(d2, u.householdId);
    expect(home.seedStatus).toBe('ready');
    expect(await listDishes(d2.db, u.householdId)).toHaveLength(30);
    await d2.db.close();
  });

  it('一部だけ入っていたら、不足分だけを補う', async () => {
    const u = await registerWithHousehold(deps, 'partial');
    await deps.db.query(
      "delete from dish_ingredients where dish_id in (select dish_id from dishes where household_id = $1 and seed_key in ('gyoza','chahan'))",
      [u.householdId],
    );
    await deps.db.query(
      "delete from dishes where household_id = $1 and seed_key in ('gyoza','chahan')",
      [u.householdId],
    );
    expect(await listDishes(deps.db, u.householdId)).toHaveLength(28);
    expect((await ensureSeeds(deps, u.householdId)).created).toBe(2);
    expect(await listDishes(deps.db, u.householdId)).toHaveLength(30);
  });

  it('ファイルが読めなくても、グループ作成は取り消さず「準備中」になる', async () => {
    const { deps: d3 } = await createTestDeps({
      loadSeed: async () => {
        throw new Error('壊れたファイル');
      },
    });
    const u = await registerWithHousehold(d3, 'broken');
    const home = await prepareHome(d3, u.householdId);
    expect(home.seedStatus).toBe('preparing');
    expect(home.household.householdId).toBe(u.householdId);
    await d3.db.close();
  });

  it('別のグループのデータには影響しない', async () => {
    const a = await registerWithHousehold(deps, 'iso-a');
    const b = await registerWithHousehold(deps, 'iso-b');
    const [dish] = await listDishes(deps.db, a.householdId);
    await removeDish(deps, a.ctx, dish.dishId);
    expect(await listDishes(deps.db, a.householdId)).toHaveLength(29);
    expect(await listDishes(deps.db, b.householdId)).toHaveLength(30);
  });
});
