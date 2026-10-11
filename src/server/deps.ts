import { createLogger } from '@/lib/logger';
import { openDbFromEnv } from '@/db';
import { configFromEnv, createDeps, type AppDeps } from '@/domain/deps';

// 開発中のホットリロードでも 1 つの接続を使い回す
const g = globalThis as unknown as { __mealPlannerDeps?: Promise<AppDeps> };

/** 本番の依存を 1 回だけ作る（DB を開き、移行を適用する） */
export function getDeps(): Promise<AppDeps> {
  g.__mealPlannerDeps ??= (async () => {
    const db = await openDbFromEnv();
    const bcryptCost = Number(process.env.BCRYPT_COST ?? 10);
    return createDeps(db, {
      bcryptCost: Number.isInteger(bcryptCost) && bcryptCost >= 4 ? bcryptCost : 10,
      logger: createLogger(),
      config: configFromEnv(),
    });
  })();
  // 開くのに失敗したときは、次のリクエストでやり直せるように覚えない
  g.__mealPlannerDeps.catch(() => {
    g.__mealPlannerDeps = undefined;
  });
  return g.__mealPlannerDeps;
}
