'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { hueOf } from '@/domain/images/hue';
import { loadDishImage } from './client';
import { AI_BADGE_TEXT, type DishImageDto } from './types';

const POLL_MS = 3000;
const MAX_POLLS = 20;

const badgeStyle: CSSProperties = {
  position: 'absolute',
  left: 6,
  bottom: 6,
  padding: '2px 8px',
  borderRadius: 10,
  background: 'rgba(0, 0, 0, 0.65)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 'normal',
  lineHeight: 1.4,
};

/**
 * 料理の画像。登録画像、「AI が作ったイメージ」の印つきの生成画像、作成中・失敗のときの色の枠を出す（BR60.3〜BR60.10）。
 * 取得に失敗したときや読み込み中は、これまでと同じ頭文字の枠のまま。作成中のあいだは、少し間を置いて取り直す（BR60.8）
 */
export function DishImageView({
  dishId,
  name,
  load = loadDishImage,
  pollMs = POLL_MS,
  maxPolls = MAX_POLLS,
  refreshKey = 0,
  onLoaded,
}: {
  dishId: string;
  name: string;
  load?: (dishId: string) => Promise<DishImageDto>;
  pollMs?: number;
  maxPolls?: number;
  /** 値が変わると取り直す（登録・外したあと） */
  refreshKey?: number;
  onLoaded?: (image: DishImageDto) => void;
}) {
  const [image, setImage] = useState<DishImageDto | null>(null);
  const [broken, setBroken] = useState(false);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    setBroken(false);
    const run = async () => {
      try {
        const next = await load(dishId);
        if (cancelled) return;
        setImage(next);
        onLoadedRef.current?.(next);
        if (next.status === 'pending' && polls < maxPolls) {
          polls += 1;
          timer = setTimeout(() => void run(), pollMs);
        }
      } catch {
        // 取れなかったときは、頭文字の枠のまま（画面を止めない）
      }
    };
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dishId, load, pollMs, maxPolls, refreshKey]);

  const initial = name.slice(0, 1);

  // 読み込み中、または取得に失敗：これまでと同じ枠
  if (!image) {
    return (
      <div className="dish-frame" aria-hidden="true" data-testid="dish-image-frame">
        {initial}
      </div>
    );
  }

  if (image.status === 'ready' && image.url && !broken) {
    return (
      <div
        className="dish-frame"
        data-testid="dish-image-box"
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={image.altText}
          data-testid="dish-image"
          onError={() => setBroken(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        {image.isAiGenerated && (
          <>
            <span aria-hidden="true" style={{ position: 'relative' }}>
              {initial}
            </span>
            <span data-testid="ai-badge" style={badgeStyle}>
              {AI_BADGE_TEXT}
            </span>
          </>
        )}
      </div>
    );
  }

  // 作成中・失敗・画像なし：料理名から決めた色の枠。「AI が作ったイメージ」の印は出さない（BR60.8、BR60.10）
  const hue = hueOf(name);
  const pending = image.status === 'pending';
  return (
    <div
      className="dish-frame"
      role="img"
      aria-label={image.altText}
      data-testid="dish-image-frame"
      data-state={pending ? 'pending' : 'failed'}
      style={{
        position: 'relative',
        background: `hsl(${hue} 70% 85%)`,
        color: `hsl(${hue} 50% 25%)`,
      }}
    >
      <span aria-hidden="true">{initial}</span>
      {pending && (
        <span data-testid="image-pending" role="status" style={badgeStyle}>
          作成中
        </span>
      )}
    </div>
  );
}
