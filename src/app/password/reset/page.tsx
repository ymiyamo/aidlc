import type { Metadata } from 'next';
import { ResetConfirmForm } from '@/ui/admin/ResetConfirmForm';

// 再設定リンクの値が、外のページへの参照元として渡らないようにする（BR50.27）
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return <ResetConfirmForm token={typeof token === 'string' && token ? token : null} />;
}
