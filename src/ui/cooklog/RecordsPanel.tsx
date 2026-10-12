'use client';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api-client';
import type { DishDto } from '../types';
import { DishPicker, PENDING_ADD_KEY } from './DishPicker';
import { RecordForm } from './RecordForm';
import { RecordItem } from './RecordItem';
import {
  dayText,
  IMPRESSION_LABEL,
  IMPRESSION_MARK,
  monthShape,
  shiftMonth,
  type CalendarDayDto,
  type MonthDto,
  type RecordDto,
  type RecordFormValues,
} from './types';

type Panel =
  | { kind: 'none' }
  | { kind: 'day'; date: string }
  | { kind: 'pick'; date: string }
  | { kind: 'input'; date: string; dish: DishDto }
  | { kind: 'edit'; record: RecordDto };

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 幅 360px でも 7 列が横にはみ出ないよう、列を縮められるようにする
const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 2,
};
const CELL: CSSProperties = {
  minHeight: 64,
  minWidth: 0,
  padding: 2,
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: 'var(--line)',
  borderRadius: 6,
  background: 'var(--card)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 11,
  lineHeight: 1.2,
  textAlign: 'left',
  cursor: 'pointer',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
const LABEL: CSSProperties = {
  overflowWrap: 'anywhere',
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 3,
  overflow: 'hidden',
};

const toBody = (v: RecordFormValues) => ({
  cookedOn: v.cookedOn,
  impression: v.impression,
  cautionMemo: v.cautionMemo,
});

const ym = (date: string) => date.slice(0, 7);

function Calendar({
  data,
  selected,
  onSelect,
}: {
  data: MonthDto;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const { firstWeekday, days } = monthShape(data.month);
  const byDate = new Map<string, CalendarDayDto>(data.days.map((d) => [d.date, d]));
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  return (
    <div data-testid="calendar" role="group" aria-label={`${data.month} のカレンダー`}>
      <div style={GRID} aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <div key={w} className="hint" style={{ textAlign: 'center' }}>
            {w}
          </div>
        ))}
      </div>
      <div style={GRID}>
        {cells.map((n, i) => {
          if (n === null) return <div key={`blank-${i}`} />;
          const date = `${data.month}-${String(n).padStart(2, '0')}`;
          const info = byDate.get(date);
          const isSelected = selected === date;
          const text = info
            ? `${dayText(date)}、${info.label}${
                info.impression !== 'none' ? `、${IMPRESSION_LABEL[info.impression]}` : ''
              }`
            : dayText(date);
          return (
            <button
              key={date}
              type="button"
              style={{
                ...CELL,
                ...(isSelected ? { borderColor: 'var(--primary)', borderWidth: 2 } : {}),
                ...(info ? { background: '#ffedd5' } : {}),
              }}
              aria-label={text}
              aria-pressed={isSelected}
              data-testid={`cal-day-${date}`}
              onClick={() => onSelect(date)}
            >
              <span aria-hidden="true">
                <strong>{n}</strong>
                {date === data.today ? '•' : ''}
              </span>
              {info && (
                <span style={LABEL} aria-hidden="true" data-testid={`cal-label-${date}`}>
                  {info.impression !== 'none' ? IMPRESSION_MARK[info.impression] : ''}
                  {info.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 記録の画面の中身：一覧／カレンダーの切り替え、日のタップ、作ったものの追加、編集・削除（BR40.12〜BR40.18） */
export function RecordsPanel() {
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MonthDto | null>(null);
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (target: string | null) => {
    try {
      const q = target ? `?month=${target}` : '';
      const d = await api<MonthDto>('GET', `/api/records${q}`);
      setData(d);
      setMonth(d.month);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // 保存の画面から戻ったときは、同じ日付の項目を選ぶ画面に戻る（BR40.18）
    let pending: string | null = null;
    try {
      pending = window.sessionStorage.getItem(PENDING_ADD_KEY);
      if (pending) window.sessionStorage.removeItem(PENDING_ADD_KEY);
    } catch {
      pending = null;
    }
    if (pending && /^\d{4}-\d{2}-\d{2}$/.test(pending)) {
      setPanel({ kind: 'pick', date: pending });
      void load(ym(pending));
    } else {
      void load(null);
    }
  }, [load]);

  if (loadError && !data) {
    return (
      <p className="error" role="alert" data-testid="records-error">
        記録を読み込めませんでした。
      </p>
    );
  }
  if (!data || !month) return <p role="status">読み込み中…</p>;

  const reloadAndShowDay = async (date: string) => {
    await load(ym(date) === month ? month : ym(date));
    setPanel({ kind: 'day', date });
  };
  const add = (dish: DishDto, date: string) => async (v: RecordFormValues) => {
    await api('POST', '/api/records', { dishId: dish.id, ...toBody(v) });
    await reloadAndShowDay(v.cookedOn || date);
  };
  const edit = (record: RecordDto) => async (v: RecordFormValues) => {
    await api('PUT', `/api/records/${record.recordId}`, toBody(v));
    await reloadAndShowDay(v.cookedOn);
  };
  const remove = async (record: RecordDto) => {
    await api('DELETE', `/api/records/${record.recordId}`);
    await load(month);
  };
  const openExisting = (recordId: string) => {
    const found = data.records.find((r) => r.recordId === recordId);
    if (found) setPanel({ kind: 'edit', record: found });
  };
  const go = (delta: number) => {
    setPanel({ kind: 'none' });
    void load(shiftMonth(month, delta));
  };

  const selectedDate = panel.kind === 'day' ? panel.date : null;
  const [year, mon] = month.split('-');

  return (
    <>
      <div className="row" role="group" aria-label="表示の切り替え">
        <button
          type="button"
          className="chip"
          aria-pressed={view === 'calendar'}
          data-testid="view-calendar"
          onClick={() => setView('calendar')}
        >
          カレンダー
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={view === 'list'}
          data-testid="view-list"
          onClick={() => setView('list')}
        >
          一覧
        </button>
      </div>

      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" className="btn small" data-testid="month-prev" onClick={() => go(-1)}>
          ◀ 前の月
        </button>
        <strong data-testid="month-title">
          {year}年{Number(mon)}月
        </strong>
        <button type="button" className="btn small" data-testid="month-next" onClick={() => go(1)}>
          次の月 ▶
        </button>
      </div>

      {view === 'calendar' && (
        <Calendar
          data={data}
          selected={selectedDate}
          onSelect={(date) => setPanel({ kind: 'day', date })}
        />
      )}

      {panel.kind === 'day' && (
        <section
          className="card"
          aria-label={`${dayText(panel.date)}の記録`}
          data-testid="day-panel"
        >
          <h2>{dayText(panel.date)}</h2>
          {(() => {
            const list = data.records
              .filter((r) => r.cookedOn === panel.date)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            const future = panel.date > data.today;
            return (
              <>
                {list.length === 0 ? (
                  <p data-testid="day-empty">この日の記録はありません</p>
                ) : (
                  <ul className="list" data-testid="day-list">
                    {list.map((r) => (
                      <RecordItem
                        key={r.recordId}
                        record={r}
                        showDate={false}
                        onEdit={(rec) => setPanel({ kind: 'edit', record: rec })}
                        onDelete={remove}
                      />
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className="btn primary block"
                  data-testid="day-add-button"
                  disabled={future}
                  aria-describedby={future ? 'day-future-hint' : undefined}
                  onClick={() => setPanel({ kind: 'pick', date: panel.date })}
                >
                  作ったものを追加
                </button>
                {future && (
                  <p className="hint" id="day-future-hint" data-testid="day-future-hint">
                    追加できるのは今日までの日付です
                  </p>
                )}
              </>
            );
          })()}
        </section>
      )}

      {panel.kind === 'pick' && (
        <DishPicker
          date={panel.date}
          onSelect={(dish) => setPanel({ kind: 'input', date: panel.date, dish })}
          onCancel={() => setPanel({ kind: 'day', date: panel.date })}
        />
      )}

      {panel.kind === 'input' && (
        <RecordForm
          dishName={panel.dish.name}
          initial={{ cookedOn: panel.date, impression: '', cautionMemo: '' }}
          maxDate={data.today}
          submitLabel="保存する"
          onSubmit={add(panel.dish, panel.date)}
          onCancel={() => setPanel({ kind: 'day', date: panel.date })}
          onOpenExisting={openExisting}
        />
      )}

      {panel.kind === 'edit' && (
        <RecordForm
          key={panel.record.recordId}
          dishName={`${panel.record.dishName}${panel.record.dishDeleted ? '（削除済み）' : ''}`}
          initial={{
            cookedOn: panel.record.cookedOn,
            impression: panel.record.impression ?? '',
            cautionMemo: panel.record.cautionMemo ?? '',
          }}
          maxDate={data.today}
          submitLabel="更新する"
          onSubmit={edit(panel.record)}
          onCancel={() => setPanel({ kind: 'day', date: panel.record.cookedOn })}
          onOpenExisting={openExisting}
        />
      )}

      <section aria-label={`${year}年${Number(mon)}月の記録の一覧`} data-testid="month-list">
        <h2 style={{ fontSize: 18 }}>この月の記録</h2>
        {data.records.length === 0 ? (
          <p data-testid="month-empty">この月の記録はありません</p>
        ) : (
          <ul className="list">
            {data.records.map((r) => (
              <RecordItem
                key={r.recordId}
                record={r}
                onEdit={(rec) => setPanel({ kind: 'edit', record: rec })}
                onDelete={remove}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
