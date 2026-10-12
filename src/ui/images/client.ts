import { api, ApiError } from '../api-client';
import { MAX_IMAGE_BYTES } from '@/domain/images/sniff';
import type { DishImageDto } from './types';

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
export const NOT_IMAGE_TEXT = '画像ではありません。JPEG、PNG、WebP、GIF の画像を選んでください';
export const TOO_LARGE_TEXT = '5MB を超えています。5MB 以下の画像を選んでください';

/**
 * 選んだ時点の簡単な確認（早く知らせるため）。最終の判定は API が中身で行う（BR60.1、BR60.2）。
 * 問題がなければ null、あれば利用者に見せる理由
 */
export function checkImageFile(file: File): string | null {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return NOT_IMAGE_TEXT;
  if (file.size > MAX_IMAGE_BYTES) return TOO_LARGE_TEXT;
  return null;
}

/** ファイルの中身を base64 の文字列にする */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
    reader.onload = () => {
      const text = String(reader.result ?? '');
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** 画像を登録する（置き換えを含む）。失敗したら ApiError */
export async function uploadImage(dishId: string, file: File): Promise<DishImageDto> {
  const data = await fileToBase64(file);
  return (await api<{ image: DishImageDto }>('PUT', `/api/dishes/${dishId}/image`, { data })).image;
}

/** 登録画像を外す */
export async function removeRegisteredImage(dishId: string): Promise<DishImageDto> {
  return (await api<{ image: DishImageDto }>('DELETE', `/api/dishes/${dishId}/image`)).image;
}

/** 料理の画像の状態を取る */
export async function loadDishImage(dishId: string): Promise<DishImageDto> {
  return (await api<{ image: DishImageDto }>('GET', `/api/dishes/${dishId}/image`)).image;
}

/** 失敗の理由を、利用者に見せる文にする */
export function imageErrorText(err: unknown): string {
  if (err instanceof ApiError) return err.fields.image ?? err.message;
  return '画像を登録できませんでした。もう一度お試しください';
}
