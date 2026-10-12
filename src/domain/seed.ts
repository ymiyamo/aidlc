import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { insertSeedDish, listSeedKeys } from '@/repo/dishes';
import type { AppDeps } from './deps';
import { seedDishSchema } from './validation';

export const SEED_COUNT = 30;
export const SEED_FILE = path.join(process.cwd(), 'data', 'seed-dishes.json');

export type SeedDish = z.infer<typeof seedDishSchema>;
export interface SeedFile {
  dishes: SeedDish[];
}

const seedFileSchema = z.object({ dishes: z.array(seedDishSchema) });

/** BR3.12：30 件、seedKey の重複なし、各行が BR3.1〜BR3.5 を満たす。違反なら例外 */
export function parseSeedFile(raw: unknown): SeedFile {
  const parsed = seedFileSchema.parse(raw);
  if (parsed.dishes.length !== SEED_COUNT) {
    throw new Error(`初期データは ${SEED_COUNT} 件が必要です（${parsed.dishes.length} 件）`);
  }
  const keys = new Set(parsed.dishes.map((d) => d.seedKey));
  if (keys.size !== parsed.dishes.length) throw new Error('seedKey が重複しています');
  return parsed;
}

export async function loadSeedFile(file: string = SEED_FILE): Promise<SeedFile> {
  return parseSeedFile(JSON.parse(await readFile(file, 'utf8')));
}

export type SeedStatus = 'ready' | 'preparing';

/**
 * 不足している初期データを、そのグループに作る（冪等）。
 * 削除済みの初期データは seedKey が残るので復活しない（BR3.12）。
 */
export async function ensureSeeds(
  deps: AppDeps,
  householdId: string,
): Promise<{ status: SeedStatus; created: number }> {
  let file: SeedFile;
  try {
    file = await deps.loadSeed();
  } catch (err) {
    // 運用者に分かるように記録し、グループ作成は取り消さない
    deps.logger.error('seed_file_invalid', { householdId, error: err });
    return { status: 'preparing', created: 0 };
  }
  const have = new Set(await listSeedKeys(deps.db, householdId));
  const missing = file.dishes.filter((d) => !have.has(d.seedKey));
  if (missing.length === 0) return { status: 'ready', created: 0 };
  let created = 0;
  await deps.db.transaction(async (tx) => {
    const now = deps.now();
    for (const d of missing) {
      const ok = await insertSeedDish(tx, householdId, {
        name: d.name,
        url: d.url,
        cookTime: d.cookTime,
        effort: d.effort,
        ingredientKind: d.ingredientKind ?? null,
        moodTags: d.moodTags,
        ingredients: d.ingredients.map((i) => ({ name: i.name, amount: i.amount, unit: i.unit })),
        memo: d.memo,
        dishId: deps.newId(),
        seedKey: d.seedKey,
        now,
      });
      if (ok) created += 1;
    }
  });
  return { status: 'ready', created };
}

/** household.created を受けて初期データを登録する受け口 */
export function registerSeedHandler(deps: AppDeps): void {
  deps.events.subscribe('household.created', async ({ householdId }) => {
    await ensureSeeds(deps, householdId);
  });
}
