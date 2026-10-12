import type { DishDto } from '../types';

/** 「今日の気分」の条件。画面が一時的に持ち、サーバーは保存しない（BR10.14） */
export interface TasteFilter {
  cookTime: NonNullable<DishDto['cookTime']> | null;
  effort: NonNullable<DishDto['effort']> | null;
  moodTags: string[];
}

export const EMPTY_FILTER: TasteFilter = { cookTime: null, effort: null, moodTags: [] };

export const isFilterEmpty = (f: TasteFilter) =>
  f.cookTime === null && f.effort === null && f.moodTags.length === 0;

/** 契約 C1 の問い合わせ：time、effort、moodTag（繰り返し）。指定していない項目は付けない */
export function filterParams(f: TasteFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.cookTime) p.set('time', f.cookTime);
  if (f.effort) p.set('effort', f.effort);
  for (const tag of f.moodTags) p.append('moodTag', tag);
  return p;
}

/** 嫌いな食材 1 件（自分の登録だけ。BR10.5） */
export interface DislikeDto {
  id: string;
  ingredientName: string;
  registeredAt: string;
}
