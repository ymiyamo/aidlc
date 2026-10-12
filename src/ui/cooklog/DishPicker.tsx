'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api-client';
import type { DishDto } from '../types';
import { dayText } from './types';

export type PickerTab = 'recent' | 'favorite' | 'all';

const TAB_LABEL: Record<PickerTab, string> = {
  recent: '最近選んだもの',
  favorite: 'お気に入り',
  all: 'すべて',
};

/** 料理名の絞り込み：含むものを出す。大文字小文字は区別せず、前後の空白は無視する（BR40.16） */
export function filterDishes(
  dishes: DishDto[],
  opts: { tab: PickerTab; query: string; pickedIds: Set<string> },
): DishDto[] {
  const q = opts.query.trim().toLowerCase();
  return dishes.filter((d) => {
    if (opts.tab === 'favorite' && !d.isFavorite) return false;
    if (opts.tab === 'recent' && !opts.pickedIds.has(d.id)) return false;
    return q === '' || d.name.toLowerCase().includes(q);
  });
}

/** 保存の画面から戻ったときに、同じ日付の項目を選ぶ画面を開き直すための印（BR40.18） */
export const PENDING_ADD_KEY = 'cooklog-pending-add-date';

interface Props {
  /** 作った日（項目を選んだあとの入力の日付になる） */
  date: string;
  onSelect: (dish: DishDto) => void;
  onCancel: () => void;
}

/** 項目を選ぶ画面（BR40.15〜BR40.18）。「選んだもの」は U1 の API から取り、削除済みでない料理と突き合わせる */
export function DishPicker({ date, onSelect, onCancel }: Props) {
  const [dishes, setDishes] = useState<DishDto[] | null>(null);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<PickerTab>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ dishes: DishDto[] }>('GET', '/api/dishes'),
      api<{ picked: { dish: DishDto }[] }>('GET', '/api/picked').catch(() => ({ picked: [] })),
    ])
      .then(([d, p]) => {
        if (cancelled) return;
        setDishes(d.dishes);
        setPickedIds(new Set(p.picked.map((x) => x.dish.id)));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(
    () => (dishes ? filterDishes(dishes, { tab, query, pickedIds }) : []),
    [dishes, tab, query, pickedIds],
  );

  const saveNew = () => {
    try {
      window.sessionStorage.setItem(PENDING_ADD_KEY, date);
    } catch {
      // 覚えられないときは、保存のあとに記録の画面を開き直してもらう
    }
  };

  return (
    <section className="card" aria-label="作ったものを選ぶ" data-testid="dish-picker">
      <h2>{dayText(date)}に作ったものを選ぶ</h2>
      <div className="form">
        <label htmlFor="picker-query">料理名で絞り込む</label>
        <input
          id="picker-query"
          data-testid="picker-query"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="chips" role="group" aria-label="表示する料理">
        {(Object.keys(TAB_LABEL) as PickerTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className="chip"
            aria-pressed={tab === t}
            data-testid={`picker-tab-${t}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          料理を読み込めませんでした。
        </p>
      )}
      {dishes && shown.length === 0 && <p data-testid="picker-empty">該当する項目がありません</p>}
      <ul className="list" data-testid="picker-list">
        {shown.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className="btn block"
              data-testid="picker-item"
              onClick={() => onSelect(d)}
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
            >
              {d.isFavorite ? '★ ' : ''}
              {d.name}
            </button>
          </li>
        ))}
      </ul>

      <p>
        <Link href="/dishes/new" data-testid="picker-save-new" onClick={saveNew}>
          見つからないときは、新しく保存する
        </Link>
      </p>
      <button type="button" className="btn block" data-testid="picker-cancel" onClick={onCancel}>
        やめる
      </button>
    </section>
  );
}
