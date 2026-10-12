'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/ui/api-client';
import { Shell, useSession } from '@/ui/Shell';
import type { DishDto } from '@/ui/types';

interface Picked {
  dish: DishDto;
  pickedAt: string;
}

export default function PickedPage() {
  const me = useSession();
  const [items, setItems] = useState<Picked[] | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ picked: Picked[] }>('GET', '/api/picked')).picked);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <p role="status">読み込み中…</p>;

  const remove = async (dishId: string) => {
    await api('DELETE', `/api/picked/${dishId}`);
    await load();
  };

  return (
    <Shell title="選んだもの">
      {items === null ? (
        <p role="status">読み込み中…</p>
      ) : items.length === 0 ? (
        <div className="card" data-testid="picked-empty">
          <p>まだ選んだものはありません。「買い物前」で「これにする」を押すと、ここに入ります。</p>
          <Link className="btn primary" href="/suggest">
            買い物前を開く
          </Link>
        </div>
      ) : (
        <>
          <Link className="btn primary block" href="/shopping" data-testid="go-shopping">
            買い物リストを見る
          </Link>
          <ul className="list" data-testid="picked-list">
            {items.map((p) => (
              <li key={p.dish.id} className="card">
                <strong>{p.dish.name}</strong>
                <div className="row" style={{ marginTop: 8 }}>
                  <Link className="btn small" href={`/dishes/${p.dish.id}`}>
                    くわしく
                  </Link>
                  <button
                    type="button"
                    className="btn small"
                    data-testid="unpick-button"
                    aria-label={`${p.dish.name}を外す`}
                    onClick={() => remove(p.dish.id)}
                  >
                    外す
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}
