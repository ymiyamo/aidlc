'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/ui/api-client';
import { Shell, useSession } from '@/ui/Shell';
import { COOK_TIME_LABEL, EFFORT_LABEL, type DishDto } from '@/ui/types';

export default function DishesPage() {
  const me = useSession();
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [dishes, setDishes] = useState<DishDto[] | null>(null);

  useEffect(() => {
    if (!me) return;
    api<{ dishes: DishDto[] }>('GET', `/api/dishes${favoriteOnly ? '?favorite=1' : ''}`)
      .then((r) => setDishes(r.dishes))
      .catch(() => setDishes([]));
  }, [me, favoriteOnly]);

  if (!me) return <p role="status">読み込み中…</p>;

  return (
    <Shell title="保存した料理">
      <div className="chips" role="group" aria-label="表示の切り替え">
        <button
          type="button"
          className="chip"
          aria-pressed={!favoriteOnly}
          data-testid="filter-all"
          onClick={() => setFavoriteOnly(false)}
        >
          すべて
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={favoriteOnly}
          data-testid="filter-fav"
          onClick={() => setFavoriteOnly(true)}
        >
          お気に入り
        </button>
      </div>
      {dishes === null ? (
        <p role="status">読み込み中…</p>
      ) : dishes.length === 0 ? (
        <p data-testid="list-empty">
          {favoriteOnly
            ? 'お気に入りはまだありません。'
            : 'まだ保存がありません。右下の「＋」から保存できます。'}
        </p>
      ) : (
        <ul className="list" data-testid="dish-list">
          {dishes.map((d) => (
            <li key={d.id}>
              <Link className="item" href={`/dishes/${d.id}`} data-testid="dish-item">
                <strong>
                  {d.isFavorite && (
                    <span className="fav" aria-label="お気に入り">
                      ♥{' '}
                    </span>
                  )}
                  {d.name}
                </strong>
                <small>
                  {[d.cookTime && COOK_TIME_LABEL[d.cookTime], d.effort && EFFORT_LABEL[d.effort]]
                    .filter(Boolean)
                    .join('・') || '調理時間・手間は未入力'}
                  {d.ingredients.length === 0 ? '　材料が未入力' : ''}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
