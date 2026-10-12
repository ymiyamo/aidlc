'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api-client';
import { RecordForm } from './RecordForm';
import { RecordItem } from './RecordItem';
import type { RecordDto, RecordFormValues } from './types';

interface Loaded {
  count: number;
  today: string;
  records: RecordDto[];
}

type Mode = { kind: 'idle' } | { kind: 'add' } | { kind: 'edit'; record: RecordDto };

const toBody = (v: RecordFormValues) => ({
  cookedOn: v.cookedOn,
  impression: v.impression,
  cautionMemo: v.cautionMemo,
});

/** 料理の詳細：作った回数と作った日の一覧（新しい順）、追加・編集・削除（BR40.6〜BR40.9） */
export function DishRecordsSection({ dishId, dishName }: { dishId: string; dishName: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Loaded>('GET', `/api/dishes/${dishId}/records`));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [dishId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <section className="card" aria-label="作った日">
        <p className="error" role="alert">
          作った日を読み込めませんでした。
        </p>
      </section>
    );
  }
  if (!data) return null;

  const add = async (v: RecordFormValues) => {
    await api('POST', '/api/records', { dishId, ...toBody(v) });
    setMode({ kind: 'idle' });
    await load();
  };
  const edit = (record: RecordDto) => async (v: RecordFormValues) => {
    await api('PUT', `/api/records/${record.recordId}`, toBody(v));
    setMode({ kind: 'idle' });
    await load();
  };
  const remove = async (record: RecordDto) => {
    await api('DELETE', `/api/records/${record.recordId}`);
    await load();
  };
  const openExisting = (recordId: string) => {
    const found = data.records.find((r) => r.recordId === recordId);
    if (found) setMode({ kind: 'edit', record: found });
  };

  return (
    <section className="card" aria-labelledby="dish-records-heading" data-testid="dish-records">
      <h2 id="dish-records-heading">作った日</h2>
      <p data-testid="dish-records-count">作った回数：{data.count} 回</p>

      {mode.kind === 'add' && (
        <RecordForm
          key="add"
          dishName={dishName}
          initial={{ cookedOn: data.today, impression: '', cautionMemo: '' }}
          maxDate={data.today}
          submitLabel="保存する"
          onSubmit={add}
          onCancel={() => setMode({ kind: 'idle' })}
          onOpenExisting={openExisting}
        />
      )}
      {mode.kind === 'edit' && (
        <RecordForm
          key={mode.record.recordId}
          dishName={dishName}
          initial={{
            cookedOn: mode.record.cookedOn,
            impression: mode.record.impression ?? '',
            cautionMemo: mode.record.cautionMemo ?? '',
          }}
          maxDate={data.today}
          submitLabel="更新する"
          onSubmit={edit(mode.record)}
          onCancel={() => setMode({ kind: 'idle' })}
          onOpenExisting={openExisting}
        />
      )}
      {mode.kind === 'idle' && (
        <button
          type="button"
          className="btn primary block"
          data-testid="record-add-button"
          onClick={() => setMode({ kind: 'add' })}
        >
          作った日を追加
        </button>
      )}

      {data.records.length === 0 ? (
        <p data-testid="dish-records-empty">まだ作った記録がありません。</p>
      ) : (
        <ul className="list" data-testid="dish-records-list">
          {data.records.map((r) => (
            <RecordItem
              key={r.recordId}
              record={r}
              showDish={false}
              onEdit={(rec) => setMode({ kind: 'edit', record: rec })}
              onDelete={remove}
            />
          ))}
        </ul>
      )}
      <p>
        <Link href="/records" data-testid="records-link">
          作った記録のカレンダーを見る
        </Link>
      </p>
    </section>
  );
}
