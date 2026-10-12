import { z } from 'zod';
import type { CandidateFilter } from '@/domain/suggestion';
import { parseOrThrow } from '@/domain/validation';

/** 空文字は「指定なし（null）」として扱う */
const emptyToNull = (v: unknown) => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v ?? null;
};

const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z.preprocess(
    emptyToNull,
    z.enum(values, { message: `${label}の選択肢が正しくありません` }).nullable(),
  );

/** 気分のタグ 1 つ。料理のタグ（U1 BR3.4）と同じ、1〜20 文字 */
const tag = z.string().trim().min(1, 'タグは1文字以上です').max(20, 'タグは20文字までです');

// BR10.10：決められた選択肢以外の値は「入力エラー」。何も指定しなくてよい（BR10.12）
const filterSchema = z.object({
  time: optionalEnum(['within15', 'within30', 'over30'], '調理時間'),
  effort: optionalEnum(['easy', 'normal', 'hard'], '手間'),
  moodTag: z
    .array(tag)
    .max(20, 'タグは20個までです')
    .default([])
    .transform((tags) => [...new Set(tags)]),
});

/**
 * 候補・件数の問い合わせの条件を読む。契約 C1 の `time`、`effort`、`moodTag`（繰り返し）。
 * 条件はサーバーに保存せず、要求のたびに画面が渡す（BR10.14）。
 * 選択肢以外の値は「入力エラー」（BR10.10）
 */
export function parseCandidateFilter(query: URLSearchParams): CandidateFilter {
  const input = parseOrThrow(filterSchema, {
    time: query.get('time'),
    effort: query.get('effort'),
    moodTag: query.getAll('moodTag').filter((t) => t.trim() !== ''),
  });
  return { cookTime: input.time, effort: input.effort, moodTags: input.moodTag };
}
