'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api-client';
import { dislikeApi, type DislikeApi } from './api';
import type { DislikeDto } from './types';

/**
 * 嫌いな食材の登録の画面の中身（BR10.1〜BR10.5、BR10.24）。
 * 家族みんなの候補から外れるが、ここに出すのは自分の登録だけ。アレルギーを防ぐものではないことを、常に表示する
 */
export function DislikesPanel({ api = dislikeApi }: { api?: DislikeApi }) {
  const [items, setItems] = useState<DislikeDto[] | null>(null);
  const [limit, setLimit] = useState(50);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.list();
      setItems(r.dislikes);
      setLimit(r.limit);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.add(name);
      setName('');
      await load();
    } catch (err) {
      // 入力は残したまま、理由を知らせる（BR10.1、BR10.3）
      setError(
        err instanceof ApiError
          ? (err.fields.ingredientName ?? err.message)
          : '登録できませんでした。もう一度お試しください',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: DislikeDto) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.remove(item.id);
    } catch (err) {
      // すでに外れていた（二重の操作など）なら、そのまま一覧を読み直す
      if (!(err instanceof ApiError && err.status === 404)) {
        setError('外せませんでした。もう一度お試しください');
      }
    } finally {
      setBusy(false);
    }
    await load();
  };

  return (
    <>
      <p className="card notice" data-testid="allergy-notice">
        好き嫌いの登録は、アレルギーを防ぐものではありません。
      </p>
      <p className="hint">
        登録した食材を材料に含む料理は、家族みんなの候補とおまかせから外れます。ここには自分の登録だけが表示されます。
      </p>

      <form className="form card" onSubmit={submit} noValidate data-testid="dislike-form">
        <label htmlFor="dislike-name">嫌いな食材</label>
        <input
          id="dislike-name"
          name="ingredientName"
          type="text"
          autoComplete="off"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'dislike-help dislike-error' : 'dislike-help'}
          onChange={(e) => setName(e.target.value)}
          data-testid="dislike-input"
        />
        <p className="hint" id="dislike-help" data-testid="dislike-help">
          食材名は、材料に書かれた文字のとおり入力してください（「えび」と「海老」は別の食材として扱います）。
        </p>
        {error && (
          <p className="error" id="dislike-error" role="alert" data-testid="dislike-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn primary block"
          disabled={busy}
          data-testid="dislike-submit"
        >
          登録する
        </button>
      </form>

      <section aria-label="登録した嫌いな食材">
        <h2 style={{ fontSize: 18 }}>
          自分の登録{' '}
          {items && (
            <small data-testid="dislike-count">
              （{items.length} / {limit} 件）
            </small>
          )}
        </h2>
        {loadFailed && !items ? (
          <p className="error" role="alert" data-testid="dislike-load-error">
            読み込めませんでした。
          </p>
        ) : !items ? (
          <p role="status">読み込み中…</p>
        ) : items.length === 0 ? (
          <p data-testid="dislike-empty">登録はまだありません</p>
        ) : (
          <ul className="list" data-testid="dislike-list">
            {items.map((d) => (
              <li key={d.id} className="card row" style={{ alignItems: 'center' }}>
                <strong className="grow" style={{ overflowWrap: 'anywhere' }}>
                  {d.ingredientName}
                </strong>
                <button
                  type="button"
                  className="btn small danger"
                  aria-label={`「${d.ingredientName}」を外す`}
                  disabled={busy}
                  data-testid={`dislike-remove-${d.id}`}
                  onClick={() => void remove(d)}
                >
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
