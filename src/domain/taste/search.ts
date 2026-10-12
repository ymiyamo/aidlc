// 「外で探す」の検索語と宛先（BR10.17、BR10.18）。サーバーにも画面にも依存しない、純粋な関数だけを置く。
// このアプリは検索結果を取り込まない。利用者の端末が、検索の画面を開くだけ。

/** 検索語に入れる調理時間の言葉（BR10.17） */
const COOK_TIME_WORD = {
  within15: '15分以内',
  within30: '30分以内',
  over30: 'それ以上',
} as const;

export interface SearchConditions {
  cookTime?: keyof typeof COOK_TIME_WORD | null;
  moodTags?: string[];
}

/**
 * 検索語：選んでいる気分のタグ（選んだ順）、調理時間の言葉、「レシピ」を、空白で並べる。
 * 何も選んでいなければ「レシピ」だけ。手間は入れない
 */
export function buildSearchQuery(c: SearchConditions = {}): string {
  const words = [
    ...(c.moodTags ?? []),
    ...(c.cookTime ? [COOK_TIME_WORD[c.cookTime]] : []),
    'レシピ',
  ];
  return words.join(' ');
}

/** YouTube の検索画面の URL。検索語は URL として安全な形に変換する（記号で宛先が変わらないように） */
export function youtubeSearchUrl(c: SearchConditions = {}): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(buildSearchQuery(c))}`;
}
