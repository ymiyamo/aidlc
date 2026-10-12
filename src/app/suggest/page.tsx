'use client';

import { PasteSaveButton } from '@/ui/PasteSaveButton';
import { Shell, useSession } from '@/ui/Shell';
import { TasteSuggest } from '@/ui/taste/TasteSuggest';
import Link from 'next/link';

export default function SuggestPage() {
  const me = useSession();
  if (!me) return <p role="status">読み込み中…</p>;
  return (
    <Shell title="買い物前">
      {/* 候補のカードに、「今日の気分」の絞り込み・おまかせ・嫌いな食材の入口を足したもの（U2） */}
      <TasteSuggest
        emptyHelp={
          <Link className="btn primary" href="/dishes/new">
            料理を保存する
          </Link>
        }
      />
      <div className="row">
        <PasteSaveButton />
        <Link className="btn" href="/picked" data-testid="go-picked">
          選んだものを見る
        </Link>
      </div>
      <p className="hint">「これにする」で選んだ料理は、家族みんなの「選んだもの」に入ります。</p>
    </Shell>
  );
}
