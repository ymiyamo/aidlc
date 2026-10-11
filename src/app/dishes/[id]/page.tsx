'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/ui/api-client';
import { DishCard } from '@/ui/DishCard';
import { DishForm, type DishFormValues } from '@/ui/DishForm';
import { Shell, useSession } from '@/ui/Shell';
import type { DishDto } from '@/ui/types';

export default function DishDetailPage() {
  const me = useSession();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [dish, setDish] = useState<DishDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDish((await api<{ dish: DishDto }>('GET', `/api/dishes/${id}`)).dish);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <p role="status">読み込み中…</p>;
  if (notFound) {
    return (
      <Shell title="料理">
        <p data-testid="not-found">この料理は見つかりません。</p>
      </Shell>
    );
  }
  if (!dish) return <p role="status">読み込み中…</p>;

  const toggleFavorite = async () => {
    const r = await api<{ dish: DishDto }>('PUT', `/api/dishes/${dish.id}/favorite`, {
      isFavorite: !dish.isFavorite,
    });
    setDish(r.dish);
  };

  const onSubmit = async (v: DishFormValues) => {
    const r = await api<{ dish: DishDto }>('PUT', `/api/dishes/${dish.id}`, v);
    setDish(r.dish);
    setEditing(false);
  };

  const remove = async () => {
    try {
      await api('DELETE', `/api/dishes/${dish.id}`);
      router.replace('/dishes');
    } catch {
      setError('削除できませんでした。もう一度お試しください');
    }
  };

  return (
    <Shell title={editing ? '料理を編集する' : '料理の詳細'} fab={false}>
      {editing ? (
        <DishForm
          initial={dish}
          submitLabel="更新する"
          onSubmit={onSubmit}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <DishCard dish={dish} onToggleFavorite={toggleFavorite} />
          {dish.ingredients.length > 0 && (
            <section className="card" aria-label="材料">
              <h2>材料</h2>
              <ul data-testid="ingredient-list">
                {dish.ingredients.map((i, n) => (
                  <li key={n}>{[i.name, i.amount, i.unit].filter(Boolean).join(' ')}</li>
                ))}
              </ul>
            </section>
          )}
          {dish.memo && (
            <section className="card" aria-label="メモ">
              <h2>メモ</h2>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{dish.memo}</p>
            </section>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {confirmingDelete ? (
            <div
              className="card notice"
              role="alertdialog"
              aria-label="削除の確認"
              data-testid="delete-confirm"
            >
              <p>「{dish.name}」を削除しますか？ 家族みんなの一覧から消えます。</p>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  data-testid="delete-cancel"
                  onClick={() => setConfirmingDelete(false)}
                >
                  やめる
                </button>
                <button
                  type="button"
                  className="btn danger"
                  data-testid="delete-confirm-button"
                  onClick={remove}
                >
                  削除する
                </button>
              </div>
            </div>
          ) : (
            <div className="row">
              <button
                type="button"
                className="btn grow"
                data-testid="edit-button"
                onClick={() => setEditing(true)}
              >
                編集する
              </button>
              <button
                type="button"
                className="btn danger grow"
                data-testid="delete-button"
                onClick={() => setConfirmingDelete(true)}
              >
                削除する
              </button>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
