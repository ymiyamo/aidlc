'use client';
import { Shell, useSession } from '@/ui/Shell';
import { ShoppingListPanel } from '@/ui/shopping/ShoppingListPanel';

export default function ShoppingPage() {
  const me = useSession();
  if (!me) return <p role="status">読み込み中…</p>;
  return (
    <Shell title="買い物リスト" fab={false}>
      <ShoppingListPanel />
    </Shell>
  );
}
