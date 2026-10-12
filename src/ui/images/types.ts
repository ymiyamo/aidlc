/** API が返す、料理の画像の状態（entities.md の DishImage） */
export interface DishImageDto {
  source: 'registered' | 'generated' | 'none';
  status: 'ready' | 'pending' | 'failed';
  url: string | null;
  isAiGenerated: boolean;
  altText: string;
}

/** 「AI が作ったイメージ」の印の文字（BR60.4） */
export const AI_BADGE_TEXT = 'AI が作ったイメージ';
