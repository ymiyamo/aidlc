import {
  insertEvent,
  listUndeliveredEvents,
  markEventDelivered,
  type AdminEventName,
  type EventRecord,
} from '@/repo/admin/events';
import type { Queryable } from '@/db/types';
import type { AppDeps } from '@/domain/deps';
import type { DomainEvents } from '@/domain/events';

type PayloadOf<N extends AdminEventName> = Omit<DomainEvents[N], 'eventId'>;

/** 元の操作と同じ処理（tx）の中で記録する。ID だけを持つ（BR50.23） */
export async function recordEvent<N extends AdminEventName>(
  tx: Queryable,
  deps: AppDeps,
  name: N,
  payload: PayloadOf<N>,
): Promise<EventRecord> {
  const eventId = deps.newId();
  const record: EventRecord = {
    eventId,
    name,
    payload: { eventId, ...(payload as Record<string, string>) },
    occurredAt: deps.now(),
  };
  await insertEvent(tx, record);
  return record;
}

/** 確定のあとで配る。受け手の失敗は、元の操作を取り消さない（BR50.23） */
export async function publishRecorded(deps: AppDeps, events: EventRecord[]): Promise<void> {
  for (const e of events) {
    try {
      await deps.events.publish(e.name, e.payload as never);
      await markEventDelivered(deps.db, e.eventId, deps.now());
    } catch (err) {
      deps.logger.error('event_delivery_failed', { event: e.name, eventId: e.eventId, error: err });
    }
  }
}

/**
 * 配れていない出来事を配り直す（アプリの起動のとき、一定の間隔で呼ぶ。BR50.23）。
 * 受け手は冪等なので、すでに届いていても結果は変わらない（BR50.24）。配った件数を返す
 */
export async function redeliverPendingEvents(deps: AppDeps): Promise<number> {
  const pending = await listUndeliveredEvents(deps.db);
  await publishRecorded(deps, pending);
  return pending.length;
}
