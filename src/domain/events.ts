import type { Logger } from '@/lib/logger';

/** アプリ内の出来事（ADR-007）。受け手は冪等に作る。失敗は送り手に影響しない */
export interface DomainEvents {
  'household.created': { householdId: string };
  // U7（BR50.23）：ID だけを持つ。eventId が同じものは、何度受けても結果が同じになるように作る
  'household.member-left': { eventId: string; householdId: string; memberId: string };
  'household.deleted': { eventId: string; householdId: string };
  'account.deleted': { eventId: string; accountId: string };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void>;

export interface EventBus {
  subscribe<K extends keyof DomainEvents>(name: K, handler: Handler<K>): void;
  publish<K extends keyof DomainEvents>(name: K, payload: DomainEvents[K]): Promise<void>;
}

export function createEventBus(logger: Logger): EventBus {
  const handlers = new Map<string, Handler<never>[]>();
  return {
    subscribe(name, handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler as Handler<never>]);
    },
    async publish(name, payload) {
      for (const h of handlers.get(name) ?? []) {
        try {
          await (h as unknown as Handler<typeof name>)(payload);
        } catch (err) {
          // 受け手の失敗で、出来事を出した側（グループ作成）は取り消さない（BR2.2）
          logger.error('event_handler_failed', { event: name, error: err });
        }
      }
    },
  };
}
