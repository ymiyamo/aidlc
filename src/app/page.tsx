'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/ui/api-client';
import { PasteSaveButton } from '@/ui/PasteSaveButton';
import { Shell, useSession } from '@/ui/Shell';

interface Home {
  householdName: string;
  seedStatus: 'ready' | 'preparing';
}

export default function HomePage() {
  const me = useSession();
  const [home, setHome] = useState<Home | null>(null);
  const [pickedCount, setPickedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!me) return;
    // 不足している初期データを補ってから表示する（BR3.12）
    api<Home>('POST', '/api/home/prepare')
      .then(setHome)
      .catch(() => undefined);
    api<{ picked: unknown[] }>('GET', '/api/picked')
      .then((r) => setPickedCount(r.picked.length))
      .catch(() => undefined);
  }, [me]);

  if (!me) return <p role="status">読み込み中…</p>;

  return (
    <Shell title={home?.householdName ?? 'ホーム'}>
      <p data-testid="greeting">こんにちは、{me.account.displayName ?? 'ようこそ'}さん</p>
      {home?.seedStatus === 'preparing' && (
        <p className="card notice" role="status" data-testid="seed-preparing">
          初期データを準備中です。保存は今すぐ使えます。
        </p>
      )}
      <Link
        className="btn primary block"
        href="/suggest"
        data-testid="go-suggest"
        style={{ minHeight: 64, fontSize: 20 }}
      >
        🍽 買い物前（今日の候補を見る）
      </Link>
      <div className="row">
        <PasteSaveButton />
        <Link className="btn" href="/dishes" data-testid="go-dishes">
          保存した料理
        </Link>
      </div>
      <Link className="btn block" href="/picked" data-testid="go-picked">
        選んだもの{pickedCount !== null ? ` ${pickedCount} 件` : ''}
      </Link>
      <Link className="btn block" href="/meal-plan" data-testid="go-meal-plan">
        📅 1 週間の献立
      </Link>
      <Link className="btn block" href="/shopping" data-testid="go-shopping">
        🛒 買い物リスト
      </Link>
      <Link className="btn block" href="/settings" data-testid="go-settings">
        ⚙ 家族の招待・設定
      </Link>
    </Shell>
  );
}
