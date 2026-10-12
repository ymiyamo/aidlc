'use client';

import { useState, type ChangeEvent } from 'react';
import { DishImageView } from './DishImageView';
import { IMAGE_ACCEPT, checkImageFile, imageErrorText, removeRegisteredImage } from './client';
import type { DishImageDto } from './types';

/**
 * 保存・編集の画面の、画像を選ぶ入力。
 * 編集のとき（dishId あり）は、いまの画像と「画像を外す」も出す。登録そのものは、保存の操作のあとに親が行う（BR60.5）
 */
export function ImagePicker({
  dishId,
  name,
  onFile,
  error,
}: {
  dishId?: string;
  name: string;
  onFile: (file: File | null) => void;
  /** 登録に失敗した理由（親が渡す） */
  error?: string | null;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [current, setCurrent] = useState<DishImageDto | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [removing, setRemoving] = useState(false);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    const problem = file ? checkImageFile(file) : null;
    setLocalError(problem);
    // 問題のある画像は選んだことにしない（料理の保存は妨げない）
    onFile(problem ? null : file);
  };

  const remove = async () => {
    if (!dishId) return;
    setRemoving(true);
    setLocalError(null);
    try {
      await removeRegisteredImage(dishId);
      setRefresh((n) => n + 1);
    } catch (err) {
      setLocalError(imageErrorText(err));
    } finally {
      setRemoving(false);
    }
  };

  const message = error ?? localError;
  return (
    <div className="image-picker" data-testid="image-picker">
      {dishId && (
        <DishImageView dishId={dishId} name={name} refreshKey={refresh} onLoaded={setCurrent} />
      )}
      <label htmlFor="dish-image">画像（任意。5MB まで。JPEG・PNG・WebP・GIF）</label>
      <input
        id="dish-image"
        data-testid="input-image"
        type="file"
        accept={IMAGE_ACCEPT}
        onChange={onChange}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? 'err-image' : undefined}
      />
      {message && (
        <p className="error" role="alert" id="err-image" data-testid="error-image">
          {message}
        </p>
      )}
      {dishId && current?.source === 'registered' && (
        <button
          type="button"
          className="btn"
          data-testid="remove-image"
          disabled={removing}
          onClick={() => void remove()}
        >
          {removing ? '外しています…' : '画像を外す'}
        </button>
      )}
    </div>
  );
}
