'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DishCard } from './DishCard';
import type { DishDto } from './types';

export type NextResult =
  | { status: 'card'; dish: DishDto; remaining: number }
  | { status: 'empty' }
  | { status: 'done' }
  // U2：絞り込みの結果が 0 件（BR10.19）／嫌いな食材のせいで候補がすべて外れた（BR10.20）
  | { status: 'no_match' }
  | { status: 'all_excluded' };

export interface DeckApi {
  next(seen: string[]): Promise<NextResult>;
  pick(dishId: string): Promise<void>;
  setFavorite?(dishId: string, isFavorite: boolean): Promise<DishDto>;
}

type State =
  | { kind: 'loading' }
  | { kind: 'card'; dish: DishDto }
  | { kind: 'done' }
  | { kind: 'empty' }
  | { kind: 'no_match' }
  | { kind: 'all_excluded' }
  | { kind: 'error'; message: string };

/** 右にこれだけ動かすと「これにする」、左なら「パス」（ボタンと同じ結果。BR4.9） */
export const SWIPE_THRESHOLD = 80;

/**
 * 買い物前の候補。1 件ずつ大きなカードで見せる。
 * 「見た料理の ID の一覧」はこの画面が持ち、サーバーは覚えない（BR4.3）。
 */
export function SuggestionDeck({
  api,
  emptyHelp,
  noMatchHelp,
  excludedHelp,
}: {
  api: DeckApi;
  emptyHelp?: ReactNode;
  /** 絞り込みで 0 件のときの「条件を変える」「おまかせ」「外で探す」の入口（U2。BR10.19） */
  noMatchHelp?: ReactNode;
  /** 除外で全部外れたときの、好き嫌いの画面への入口（U2。BR10.20） */
  excludedHelp?: ReactNode;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [dx, setDx] = useState(0);
  const seen = useRef<string[]>([]);
  const busy = useRef(false);
  const startX = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.next(seen.current);
      setState(r.status === 'card' ? { kind: 'card', dish: r.dish } : { kind: r.status });
    } catch {
      setState({ kind: 'error', message: '候補を読み込めませんでした。もう一度お試しください' });
    }
  }, [api]);

  useEffect(() => {
    seen.current = [];
    void load();
  }, [load]);

  const decide = async (action: 'pick' | 'pass') => {
    if (state.kind !== 'card' || busy.current) return;
    busy.current = true;
    const dish = state.dish;
    try {
      if (action === 'pick') await api.pick(dish.id);
      seen.current = [...seen.current, dish.id];
      setDx(0);
      await load();
    } catch {
      setDx(0);
      setState({ kind: 'error', message: '操作できませんでした。もう一度お試しください' });
    } finally {
      busy.current = false;
    }
  };

  const restart = () => {
    seen.current = [];
    setState({ kind: 'loading' });
    void load();
  };

  const toggleFavorite = async () => {
    if (state.kind !== 'card' || !api.setFavorite) return;
    const updated = await api.setFavorite(state.dish.id, !state.dish.isFavorite);
    setState({ kind: 'card', dish: updated });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current !== null) setDx(e.clientX - startX.current);
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (startX.current === null) return;
    const moved = e.clientX - startX.current;
    startX.current = null;
    if (moved >= SWIPE_THRESHOLD) void decide('pick');
    else if (moved <= -SWIPE_THRESHOLD) void decide('pass');
    else setDx(0);
  };

  if (state.kind === 'loading') {
    return (
      <p role="status" data-testid="deck-loading">
        読み込み中…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="card" role="alert" data-testid="deck-error">
        <p>{state.message}</p>
        <button type="button" className="btn" onClick={restart}>
          もう一度読み込む
        </button>
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="card" data-testid="empty-message">
        <h2>まだ保存がありません</h2>
        <p>気になった料理の URL を「＋」から保存すると、ここに出てきます。</p>
        {emptyHelp}
      </div>
    );
  }
  if (state.kind === 'no_match') {
    return (
      <div className="card" role="status" data-testid="no-match-message">
        <h2>条件に合う料理がありません</h2>
        <p>絞り込みを緩めてみてください。</p>
        {noMatchHelp}
      </div>
    );
  }
  if (state.kind === 'all_excluded') {
    return (
      <div className="card" role="status" data-testid="all-excluded-message">
        <h2>候補がすべて外れています</h2>
        <p>登録された嫌いな食材で、候補がすべて外れています。好き嫌いの登録を見直せます。</p>
        {excludedHelp}
      </div>
    );
  }
  if (state.kind === 'done') {
    return (
      <div className="card" data-testid="done-message">
        <h2>見終えました</h2>
        <p>候補はこれで全部です。もう一度見たいときは「最初から見る」を押してください。</p>
        <button
          type="button"
          className="btn primary block"
          data-testid="restart-button"
          onClick={restart}
        >
          最初から見る
        </button>
      </div>
    );
  }

  return (
    <div className="deck">
      <div
        className="swipe-area"
        data-testid="swipe-area"
        tabIndex={0}
        aria-label="候補のカード。右に動かすと「これにする」、左に動かすと「パス」。ボタンでも同じ操作ができます"
        style={{ transform: `translateX(${dx}px) rotate(${dx / 30}deg)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') void decide('pick');
          if (e.key === 'ArrowLeft') void decide('pass');
        }}
      >
        <DishCard
          dish={state.dish}
          onToggleFavorite={api.setFavorite ? toggleFavorite : undefined}
        />
      </div>
      <p className="swipe-hint" aria-hidden="true">
        <span>← パス</span>
        <span>これにする →</span>
      </p>
      <div className="swipe-actions">
        <button
          type="button"
          className="btn pass"
          data-testid="pass-button"
          onClick={() => void decide('pass')}
        >
          ✕ パス
        </button>
        <button
          type="button"
          className="btn primary"
          data-testid="pick-button"
          onClick={() => void decide('pick')}
        >
          ♥ これにする
        </button>
      </div>
    </div>
  );
}
