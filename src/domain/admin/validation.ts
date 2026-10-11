import { z } from 'zod';

/** 空文字を「未入力（null）」として扱う */
const emptyToNull = (v: unknown) => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v ?? null;
};

const token = z
  .string({ message: 'リンクが正しくありません' })
  .min(1, 'リンクが正しくありません')
  .max(200, 'リンクが正しくありません');

const password = z
  .string({ message: 'パスワードを入力してください' })
  .min(8, 'パスワードは8文字以上にしてください')
  .max(200, 'パスワードは200文字までです');

export const resetRequestSchema = z.object({
  email: z
    .string({ message: 'メールアドレスを入力してください' })
    .trim()
    .max(254, 'メールアドレスが長すぎます')
    .email('メールアドレスの形式が正しくありません'),
});

export const tokenOnlySchema = z.object({ token });
export const newPasswordSchema = z.object({ password });

export const tokenSchema = z.object({ token });

export const joinSchema = z.object({
  token,
  displayName: z.preprocess(emptyToNull, z.string().max(50, '表示名は50文字までです').nullable()),
});

export const leaveSchema = z.object({
  confirm: z.literal(true, { message: '確認が必要です' }),
  confirmLast: z.boolean().optional(),
});

export const deleteAccountSchema = z.object({
  confirm: z.literal(true, { message: '確認が必要です' }),
  password: z
    .string({ message: 'パスワードを入力してください' })
    .min(1, 'パスワードを入力してください')
    .max(200, 'パスワードは200文字までです'),
});
