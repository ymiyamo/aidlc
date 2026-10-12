'use client';
import { Shell, useSession } from '@/ui/Shell';
import { RecordsPanel } from '@/ui/cooklog/RecordsPanel';

export default function RecordsPage() {
  const me = useSession();
  if (!me) return <p role="status">読み込み中…</p>;
  return (
    <Shell title="作った記録" fab={false}>
      <RecordsPanel />
    </Shell>
  );
}
