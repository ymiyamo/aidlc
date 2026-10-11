import type { Queryable } from '@/db/types';

/** U7 が出す出来事の名前（BR50.23） */
export type AdminEventName = 'household.member-left' | 'household.deleted' | 'account.deleted';

export interface EventRecord {
  eventId: string;
  name: AdminEventName;
  payload: Record<string, string>;
  occurredAt: Date;
}

/** 元の操作と同じ処理（tx）の中で呼ぶ。操作だけ確定して出来事がない状態を作らない */
export async function insertEvent(q: Queryable, e: EventRecord): Promise<void> {
  await q.query(
    'insert into domain_events (event_id, name, payload, occurred_at) values ($1, $2, $3::jsonb, $4)',
    [e.eventId, e.name, JSON.stringify(e.payload), e.occurredAt],
  );
}

export async function markEventDelivered(q: Queryable, eventId: string, now: Date) {
  await q.query('update domain_events set delivered_at = $2 where event_id = $1', [eventId, now]);
}

/** 配れていない出来事（古い順）。配り直しに使う */
export async function listUndeliveredEvents(q: Queryable, limit = 100): Promise<EventRecord[]> {
  const res = await q.query<{
    event_id: string;
    name: AdminEventName;
    payload: Record<string, string>;
    occurred_at: Date;
  }>(
    `select event_id, name, payload, occurred_at from domain_events
     where delivered_at is null order by occurred_at, event_id limit $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    eventId: r.event_id,
    name: r.name,
    payload: r.payload,
    occurredAt: r.occurred_at,
  }));
}
