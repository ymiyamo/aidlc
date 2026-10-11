'use client';
import { Shell, useSession } from '@/ui/Shell';
import { SettingsPanel } from '@/ui/admin/SettingsPanel';

export default function SettingsPage() {
  const me = useSession();
  if (!me) return <p role="status">読み込み中…</p>;
  return (
    <Shell title="設定" fab={false}>
      <SettingsPanel />
    </Shell>
  );
}
