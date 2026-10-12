'use client';

import { useEffect, useState } from 'react';
import { youtubeSearchUrl } from '@/domain/taste/search';
import { COOK_TIME_LABEL, EFFORT_LABEL } from '../types';
import type { TasteSuggestApi } from './api';
import { EMPTY_FILTER, isFilterEmpty, type TasteFilter } from './types';

type CookTimeKey = keyof typeof COOK_TIME_LABEL;
type EffortKey = keyof typeof EFFORT_LABEL;

/**
 * 「今日の気分」のシート（BR10.10〜BR10.15）。
 * 調理時間・手間は 1 つだけ、気分のタグは複数選べる。条件を選ぶたびに、合う料理の件数を出す。
 * 選んだ条件は、この画面が一時的に持つ。サーバーには保存しない（BR10.14）
 */
export function MoodSheet({
  api,
  initial,
  onApply,
  onRandom,
  onClose,
}: {
  api: Pick<TasteSuggestApi, 'count' | 'moodTags'>;
  initial: TasteFilter;
  onApply(filter: TasteFilter): void;
  onRandom(): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState<TasteFilter>(initial);
  const [tags, setTags] = useState<string[] | null>(null);
  const [count, setCount] = useState<number | 'loading' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .moodTags()
      .then((t) => !cancelled && setTags(t))
      .catch(() => !cancelled && setTags([]));
    return () => {
      cancelled = true;
    };
  }, [api]);

  // 条件を変えるたびに数え直す。古い答えが新しい答えを上書きしないようにする
  useEffect(() => {
    let cancelled = false;
    setCount('loading');
    api
      .count(draft)
      .then((n) => !cancelled && setCount(n))
      .catch(() => !cancelled && setCount('error'));
    return () => {
      cancelled = true;
    };
  }, [api, draft]);

  const setTime = (t: CookTimeKey) =>
    setDraft((d) => ({ ...d, cookTime: d.cookTime === t ? null : t }));
  const setEffort = (e: EffortKey) =>
    setDraft((d) => ({ ...d, effort: d.effort === e ? null : e }));
  const toggleTag = (tag: string) =>
    setDraft((d) => ({
      ...d,
      moodTags: d.moodTags.includes(tag)
        ? d.moodTags.filter((x) => x !== tag)
        : [...d.moodTags, tag],
    }));

  // 選んだタグが料理から消えても、条件は有効のまま（0 件になりうる。BR10.10）。選択肢に出ていなくても選択中として見せる
  const tagChoices = [...(tags ?? []), ...draft.moodTags.filter((t) => !(tags ?? []).includes(t))];

  return (
    <section className="card" aria-label="今日の気分" data-testid="mood-sheet">
      <h2>今日の気分</h2>

      <div role="group" aria-labelledby="mood-time-label">
        <p id="mood-time-label" className="hint">
          調理時間（1 つ）
        </p>
        {/* 選択肢は折り返して並べ、横にスクロールさせない（BR10.15）。.row は flex-wrap */}
        <div className="row">
          {(Object.keys(COOK_TIME_LABEL) as CookTimeKey[]).map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={draft.cookTime === t}
              data-testid={`mood-time-${t}`}
              onClick={() => setTime(t)}
            >
              {COOK_TIME_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-labelledby="mood-effort-label">
        <p id="mood-effort-label" className="hint">
          手間（1 つ）
        </p>
        <div className="row">
          {(Object.keys(EFFORT_LABEL) as EffortKey[]).map((e) => (
            <button
              key={e}
              type="button"
              className="chip"
              aria-pressed={draft.effort === e}
              data-testid={`mood-effort-${e}`}
              onClick={() => setEffort(e)}
            >
              {EFFORT_LABEL[e]}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-labelledby="mood-tag-label">
        <p id="mood-tag-label" className="hint">
          気分のタグ（いくつでも）
        </p>
        {tags === null ? (
          <p role="status">読み込み中…</p>
        ) : tagChoices.length === 0 ? (
          <p className="hint" data-testid="mood-tags-empty">
            タグのついた料理がまだありません
          </p>
        ) : (
          <div className="row" data-testid="mood-tags">
            {tagChoices.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip"
                aria-pressed={draft.moodTags.includes(tag)}
                data-testid={`mood-tag-${tag}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <p role="status" aria-live="polite" data-testid="mood-count">
        {count === 'loading'
          ? '件数を数えています…'
          : count === 'error'
            ? '件数を数えられませんでした'
            : `条件に合う料理：${count}件`}
      </p>

      <div className="row">
        <button
          type="button"
          className="btn primary grow"
          data-testid="mood-apply"
          onClick={() => onApply(draft)}
        >
          見る
        </button>
        <button
          type="button"
          className="btn"
          data-testid="mood-reset"
          disabled={isFilterEmpty(draft)}
          onClick={() => setDraft(EMPTY_FILTER)}
        >
          条件をリセット
        </button>
      </div>
      <div className="row">
        <button type="button" className="btn grow" data-testid="mood-random" onClick={onRandom}>
          おまかせ
        </button>
        {/* 検索の画面を新しいタブで開くだけ。このアプリの情報は渡さず、結果は取り込まない（BR10.17、BR10.18） */}
        <a
          className="btn grow"
          data-testid="mood-outside"
          href={youtubeSearchUrl(draft)}
          target="_blank"
          rel="noopener noreferrer"
        >
          外で探す
        </a>
      </div>
      <button type="button" className="btn small" data-testid="mood-close" onClick={onClose}>
        閉じる
      </button>
    </section>
  );
}
