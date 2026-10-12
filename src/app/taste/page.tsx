'use client';
import { Shell, useSession } from '@/ui/Shell';
import { DislikesPanel } from '@/ui/taste/DislikesPanel';
import Link from 'next/link';

/** 嫌いな食材の登録の画面（U2）。買い物前の画面から入る */
export default function TastePage() {
  const me = useSession();
  if (!me) return <p role="status">読み込み中…</p>;
  return (
    <Shell title="嫌いな食材" fab={false}>
      <DislikesPanel />
      <Link className="btn" href="/suggest" data-testid="back-suggest">
        買い物前にもどる
      </Link>
    </Shell>
  );
}
