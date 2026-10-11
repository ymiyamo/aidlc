import { z } from 'zod';
import { DomainError } from './errors';

/** 空文字を「未入力（null）」として扱う */
const emptyToNull = (v: unknown) => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v ?? null;
};

const optionalText = (max: number, label: string) =>
  z.preprocess(emptyToNull, z.string().max(max, `${label}は${max}文字までです`).nullable());

const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z.preprocess(
    emptyToNull,
    z.enum(values, { message: `${label}の選択肢が正しくありません` }).nullable(),
  );

// ---------- BR1：アカウント ----------
export const registerSchema = z.object({
  email: z
    .string({ message: 'メールアドレスを入力してください' })
    .trim()
    .max(254, 'メールアドレスが長すぎます')
    .email('メールアドレスの形式が正しくありません'),
  password: z
    .string({ message: 'パスワードを入力してください' })
    .min(8, 'パスワードは8文字以上にしてください')
    .max(200, 'パスワードは200文字までです'),
  displayName: optionalText(50, '表示名'),
});

export const loginSchema = z.object({
  email: z.string({ message: 'メールアドレスを入力してください' }).trim().max(254),
  password: z.string({ message: 'パスワードを入力してください' }).max(200),
});

// ---------- BR2：グループ ----------
export const householdSchema = z.object({
  name: z.preprocess(
    (v) => {
      const t = emptyToNull(v);
      return t === null ? 'わが家' : t;
    },
    z.string().min(1).max(50, 'グループ名は50文字までです'),
  ),
});

// ---------- BR3：料理 ----------
const tag = z.string().trim().min(1, 'タグは1文字以上です').max(20, 'タグは20文字までです');

const ingredient = z.object({
  name: z.string().trim().min(1, '材料名を入力してください').max(50, '材料名は50文字までです'),
  amount: optionalText(30, '分量'),
  unit: optionalText(20, '単位'),
});

export const dishSchema = z.object({
  name: z
    .string({ message: '料理名を入力してください' })
    .trim()
    .min(1, '料理名を入力してください')
    .max(100, '料理名は100文字までです'),
  url: z
    .string({ message: 'URLを入力してください' })
    .trim()
    .max(2000, 'URLは2000文字までです')
    .regex(
      /^https?:\/\/\S+$/,
      'URLの形式が正しくありません（http:// か https:// で始めてください）',
    ),
  cookTime: optionalEnum(['within15', 'within30', 'over30'], '調理時間'),
  effort: optionalEnum(['easy', 'normal', 'hard'], '手間'),
  moodTags: z
    .array(tag)
    .max(5, 'タグは5個までです')
    .default([])
    .refine((tags) => new Set(tags).size === tags.length, 'タグが重複しています'),
  ingredients: z.array(ingredient).max(50, '材料は50行までです').default([]),
  memo: optionalText(1000, 'メモ'),
});
export type DishFormInput = z.infer<typeof dishSchema>;

export const seedDishSchema = dishSchema.extend({
  seedKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'seedKey の形式が正しくありません'),
});

/** zod の結果を、項目名 → メッセージの形にして DomainError にする */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  throw new DomainError('validation', '入力エラー', fields);
}
