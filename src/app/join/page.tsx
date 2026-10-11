import type { Metadata } from 'next';
import { JoinPanel } from '@/ui/admin/JoinPanel';

// 招待リンクの値が、外のページへの参照元として渡らないようにする（BR50.27）
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return <JoinPanel token={typeof token === 'string' && token ? token : null} />;
}
