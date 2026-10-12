import type { IngredientKindDto } from '../types';

/** API が返す料理（src/domain/mealplan の PlanDishView と同じ形） */
export interface PlanDishDto {
  dishId: string;
  name: string;
  deleted: boolean;
  ingredientKind: IngredientKindDto | null;
}

export type DayStatusDto = 'assigned' | 'skip' | 'empty';
export type EmptyReasonDto =
  'not_enough_dishes' | 'no_valid_combination' | 'not_proposed' | 'dish_unavailable';

/** 献立の 1 日（src/domain/mealplan の PlanDayView と同じ形） */
export interface PlanDayDto {
  date: string;
  dayStatus: DayStatusDto;
  origin: 'suggested' | 'assigned_by_user' | null;
  emptyReason: EmptyReasonDto | null;
  dish: PlanDishDto | null;
}

/** 献立 1 つ（src/domain/mealplan の MealPlanView と同じ形） */
export interface MealPlanDto {
  planId: string;
  startDate: string;
  isSaved: boolean;
  name: string | null;
  savedAt: string | null;
  days: PlanDayDto[];
  emptyCount: number;
  skipCount: number;
  sameKindStreak: boolean;
}

export interface PlanNoticeDto {
  code: string;
  message: string;
}

export interface PlanResultDto {
  plan: MealPlanDto;
  notices: PlanNoticeDto[];
}

export interface SavedPlanDto {
  planId: string;
  name: string;
  startDate: string;
  savedAt: string;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 「3/2（月）」。暦の日のまま扱い、端末の時差に左右されない */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}（${WEEKDAYS[weekday]}）`;
}

/** 空欄の理由の文（BR30.8）。料理が足りないときは保存の案内を添える */
export function emptyReasonText(reason: EmptyReasonDto | null): string {
  switch (reason) {
    case 'not_enough_dishes':
      return '料理が足りないため、この日は決められませんでした。';
    case 'no_valid_combination':
      return '条件を満たす組み合わせがなく、この日は決められませんでした。';
    case 'dish_unavailable':
      return '呼び出したとき、料理が削除されたか使えなくなっていたため、空欄にしました。';
    default:
      return 'まだ料理を決めていません。「この日をやり直す」か、選んだものから入れられます。';
  }
}

/** 料理の保存を案内する理由か（足りない・組み合わせがない） */
export const suggestsSaving = (reason: EmptyReasonDto | null): boolean =>
  reason === 'not_enough_dishes' || reason === 'no_valid_combination';
