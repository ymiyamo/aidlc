export interface IngredientDto {
  name: string;
  amount: string | null;
  unit: string | null;
}

export interface DishDto {
  id: string;
  name: string;
  url: string;
  cookTime: 'within15' | 'within30' | 'over30' | null;
  effort: 'easy' | 'normal' | 'hard' | null;
  moodTags: string[];
  ingredients: IngredientDto[];
  memo: string | null;
  isFavorite: boolean;
  source: 'user' | 'seed';
  updatedAt: string;
}

export const COOK_TIME_LABEL = {
  within15: '15分以内',
  within30: '30分以内',
  over30: 'それ以上',
} as const;

export const EFFORT_LABEL = {
  easy: '楽',
  normal: 'ふつう',
  hard: '頑張れる',
} as const;

/** リンクにしてよい URL か（http/https だけ。画面でも確認する。NFR3.9） */
export const isSafeUrl = (url: string) => /^https?:\/\//.test(url);
