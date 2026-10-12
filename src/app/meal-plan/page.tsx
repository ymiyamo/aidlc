'use client';
import { Shell, useSession } from '@/ui/Shell';
import { MealPlanPanel } from '@/ui/mealplan/MealPlanPanel';

export default function MealPlanPage() {
  const me = useSession();
  if (!me) return <p role="status">読み込み中…</p>;
  return (
    <Shell title="献立" fab={false}>
      <MealPlanPanel />
    </Shell>
  );
}
