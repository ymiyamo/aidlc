import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/types';
import { createLogger, type Logger } from '@/lib/logger';
import { createEventBus, type EventBus } from './events';
import { loadSeedFile, registerSeedHandler, type SeedFile } from './seed';

/** アプリ全体の依存。時刻・乱数・変換の強さはテストで差し替えられる */
export interface AppDeps {
  db: Db;
  now(): Date;
  /** 0 以上 1 未満の乱数（候補の順番） */
  random(): number;
  newId(): string;
  bcryptCost: number;
  /** 初期データの読み込み（差し替え可能） */
  loadSeed(): Promise<SeedFile>;
  logger: Logger;
  events: EventBus;
  config: {
    cookieSecure: boolean;
    /** 設定すると Origin の照合に、リクエストの URL ではなくこの値を使う */
    appOrigin: string | null;
    /** true のとき（本番）、appOrigin が未設定なら状態を変える操作を拒否する（Host を信用しない） */
    requireAppOrigin: boolean;
  };
}

export function createDeps(db: Db, over: Partial<Omit<AppDeps, 'db' | 'events'>> = {}): AppDeps {
  const logger = over.logger ?? createLogger();
  const deps: AppDeps = {
    db,
    now: () => new Date(),
    random: Math.random,
    newId: randomUUID,
    bcryptCost: 10,
    loadSeed: loadSeedFile,
    logger,
    events: createEventBus(logger),
    config: { cookieSecure: false, appOrigin: null, requireAppOrigin: false },
    ...over,
  };
  registerSeedHandler(deps);
  return deps;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppDeps['config'] {
  const secure = env.COOKIE_SECURE;
  return {
    cookieSecure: secure !== undefined ? secure === 'true' : env.NODE_ENV === 'production',
    appOrigin: env.APP_ORIGIN || null,
    requireAppOrigin: env.NODE_ENV === 'production',
  };
}
