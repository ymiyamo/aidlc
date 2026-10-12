'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, ApiError } from '../api-client';
import {
  dishText,
  itemText,
  orderItems,
  type CompleteResultDto,
  type ShoppingItemDto,
  type ShoppingListDto,
} from './types';

// 幅 360px でも横にはみ出さないよう、長い名前は折り返す
const WRAP: CSSProperties = { overflowWrap: 'anywhere', minWidth: 0 };
// `.form input` と違い、チェックボックスは元の大きさのまま。押す範囲は行全体（44px 以上）にする
const CHECK: CSSProperties = { width: 24, height: 24, flex: '0 0 auto', margin: 0 };
const LABEL: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 44,
  cursor: 'pointer',
};

const STALE_TEXT = '最新の状態にできませんでした。前回保存した内容を表示しています。';

/** 買い物リストの画面の中身：材料の行、チェック、材料未入力の案内、空の案内、買い物おわり（BR20.8〜BR20.13） */
export function ShoppingListPanel() {
  const [list, setList] = useState<ShoppingListDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CompleteResultDto | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ list: ShoppingListDto }>('GET', '/api/shopping-list');
      setList({ ...res.list, items: orderItems(res.list.items) });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError && !list) {
    return (
      <p className="error" role="alert" data-testid="shopping-error">
        買い物リストを読み込めませんでした。
      </p>
    );
  }
  if (!list) return <p role="status">読み込み中…</p>;

  const replaceItem = (itemId: string, next: Partial<ShoppingItemDto>) =>
    setList((cur) =>
      cur
        ? {
            ...cur,
            items: orderItems(cur.items.map((i) => (i.itemId === itemId ? { ...i, ...next } : i))),
          }
        : cur,
    );

  // 画面を先に変え、保存できなければ元に戻して知らせる（WF2）
  const toggle = async (item: ShoppingItemDto) => {
    const checked = !item.checked;
    setError(null);
    replaceItem(item.itemId, { checked });
    try {
      const res = await api<{ item: ShoppingItemDto }>(
        'PUT',
        `/api/shopping-list/items/${item.itemId}/checked`,
        { checked },
      );
      replaceItem(item.itemId, res.item);
    } catch (err) {
      replaceItem(item.itemId, { checked: item.checked });
      setError(
        err instanceof ApiError && err.status === 409 ? err.message : '保存できませんでした',
      );
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<CompleteResultDto>('POST', '/api/shopping-list/complete');
      setDone(res);
      setConfirming(false);
      await load();
    } catch {
      setError('買い物おわりにできませんでした。もう一度お試しください');
    } finally {
      setBusy(false);
    }
  };

  const checkable = list.items.filter((i) => i.kind === 'ingredient');
  const checkedCount = checkable.filter((i) => i.checked).length;

  return (
    <>
      {done && (
        <p className="card notice" role="status" data-testid="shopping-done">
          買い物おわり。お疲れさまでした。
          {done.unpickPending
            ? '選んだものの整理が一部できませんでした。次にこの画面を開いたときにやり直します。'
            : '選んだものを整理しました。'}
        </p>
      )}
      {list.stale && (
        <p className="card notice" role="status" data-testid="shopping-stale">
          {STALE_TEXT}
        </p>
      )}
      {error && (
        <p className="error" role="alert" data-testid="shopping-action-error">
          {error}
        </p>
      )}

      {list.empty ? (
        <div className="card" data-testid="shopping-empty">
          <p>
            買い物リストは空です。「買い物前」で「これにする」を押すと、材料がここに集まります。
          </p>
          <Link className="btn primary" href="/suggest">
            買い物前を開く
          </Link>
        </div>
      ) : (
        <>
          {checkable.length > 0 && (
            <p className="hint" data-testid="shopping-progress">
              {checkable.length} 件中 {checkedCount} 件にチェック済み
            </p>
          )}
          <ul className="list" data-testid="shopping-list">
            {list.items.map((item) =>
              item.kind === 'needsInput' ? (
                <li key={item.itemId} className="card" data-testid="shopping-needs-input">
                  <p style={WRAP}>
                    <strong>{dishText(item)}</strong>：材料の入力が必要
                  </p>
                  <p className="hint">材料が入っていないため、買い物リストに載せられません。</p>
                  {!item.dishes[0]?.deleted && (
                    <Link className="btn small" href={`/dishes/${item.dishes[0].dishId}`}>
                      材料を入力する
                    </Link>
                  )}
                </li>
              ) : (
                <li key={item.itemId} className="card" data-testid="shopping-item">
                  <label style={LABEL}>
                    <input
                      type="checkbox"
                      style={CHECK}
                      checked={item.checked}
                      data-testid="shopping-check"
                      onChange={() => toggle(item)}
                    />
                    <span style={WRAP}>
                      <strong
                        data-testid="shopping-item-text"
                        style={item.checked ? { textDecoration: 'line-through' } : undefined}
                      >
                        {itemText(item)}
                      </strong>
                      <span className="hint" style={{ display: 'block' }}>
                        {dishText(item)}
                      </span>
                    </span>
                  </label>
                </li>
              ),
            )}
          </ul>
          <button
            type="button"
            className="btn primary block"
            data-testid="shopping-complete-button"
            disabled={busy || confirming}
            onClick={() => setConfirming(true)}
          >
            買い物おわり
          </button>
        </>
      )}

      {confirming && (
        <div
          className="card"
          role="alertdialog"
          aria-label="買い物おわりの確認"
          data-testid="shopping-complete-confirm-box"
        >
          <p>
            買い物を終わりにして、このリストの料理を「選んだもの」から外します。よろしいですか？
          </p>
          <div className="row">
            <button
              type="button"
              className="btn grow"
              data-testid="shopping-complete-cancel"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn primary grow"
              data-testid="shopping-complete-confirm"
              disabled={busy}
              onClick={finish}
            >
              終わりにする
            </button>
          </div>
        </div>
      )}
    </>
  );
}
