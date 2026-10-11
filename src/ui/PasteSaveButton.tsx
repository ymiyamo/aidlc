'use client';

import { useRouter } from 'next/navigation';

/** 「貼り付けて保存」：クリップボードの URL を入れた状態で保存の画面を開く（BR3.14）。読めなければ空で開く */
export function PasteSaveButton() {
  const router = useRouter();
  const open = async () => {
    let url = '';
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (/^https?:\/\/\S+$/.test(text)) url = text;
    } catch {
      // クリップボードを読めない環境では、URL 欄を空にして開く
    }
    router.push(url ? `/dishes/new?url=${encodeURIComponent(url)}` : '/dishes/new');
  };
  return (
    <button type="button" className="btn" data-testid="paste-save-button" onClick={open}>
      貼り付けて保存
    </button>
  );
}
