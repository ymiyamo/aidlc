import { createDeps, type AppDeps } from '@/domain/deps';
import { register } from '@/domain/auth';
import { createHousehold } from '@/domain/household';
import { silentLogger, type Logger } from '@/lib/logger';
import { createTestDb } from './db';

export interface TestClock {
  current: Date;
  now(): Date;
  advanceMs(ms: number): void;
}

export function createClock(start = '2026-01-01T00:00:00Z'): TestClock {
  const clock: TestClock = {
    current: new Date(start),
    now: () => new Date(clock.current),
    advanceMs: (ms) => {
      clock.current = new Date(clock.current.getTime() + ms);
    },
  };
  return clock;
}

/** 時刻・乱数・パスワード変換の強さを差し替えた、テスト用の依存（DB は空のメモリ上 PGlite） */
export async function createTestDeps(
  over: { random?: () => number; logger?: Logger; loadSeed?: AppDeps['loadSeed'] } = {},
): Promise<{ deps: AppDeps; clock: TestClock }> {
  const db = await createTestDb();
  const clock = createClock();
  const deps = createDeps(db, {
    now: clock.now,
    random: over.random ?? (() => 0),
    bcryptCost: 4,
    logger: over.logger ?? silentLogger,
    ...(over.loadSeed ? { loadSeed: over.loadSeed } : {}),
  });
  return { deps, clock };
}

let counter = 0;

/** 登録して、グループまで作る。初期データも入る */
export async function registerWithHousehold(deps: AppDeps, label = 'user') {
  counter += 1;
  const email = `${label}${counter}@example.com`;
  const session = await register(deps, { email, password: 'password-1234', displayName: label });
  const { householdId, memberId } = await createHousehold(deps, session.accountId, { name: label });
  return { email, session, householdId, memberId, ctx: { householdId, memberId } };
}
