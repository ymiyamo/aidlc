'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { youtubeSearchUrl } from '@/domain/taste/search';
import { SuggestionDeck, type DeckApi } from '../SuggestionDeck';
import { COOK_TIME_LABEL, EFFORT_LABEL } from '../types';
import { tasteSuggestApi, type TasteSuggestApi } from './api';
import { MoodSheet } from './MoodSheet';
import { EMPTY_FILTER, isFilterEmpty, type TasteFilter } from './types';

/** 選んでいる条件の短い説明（例：15分以内・楽・さっぱり） */
export const filterSummary = (f: TasteFilter) =>
  [
    ...(f.cookTime ? [COOK_TIME_LABEL[f.cookTime]] : []),
    ...(f.effort ? [EFFORT_LABEL[f.effort]] : []),
    ...f.moodTags,
  ].join('・');

/**
 * 「買い物前」の中身：候補のカードに、「今日の気分」の絞り込み・おまかせ・外で探す・0 件の案内を足したもの。
 * 条件はこの画面が持ち、候補を要求するたびに渡す。条件を変える・「見る」を押すと、見た料理の一覧を空にして最初から出す（BR10.14）
 */
export function TasteSuggest({
  api = tasteSuggestApi,
  emptyHelp,
}: {
  api?: TasteSuggestApi;
  emptyHelp?: ReactNode;
}) {
  const [filter, setFilter] = useState<TasteFilter>(EMPTY_FILTER);
  const [random, setRandom] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // 同じ条件で「見る」を押し直したときも、deck を作り直して最初から出す
  const [round, setRound] = useState(0);

  // 条件か表示が変わると、deck の api が替わり、deck は見た料理の一覧を空にして読み直す
  const deckApi = useMemo<DeckApi>(
    () => ({
      next: (seen) => (random ? api.random() : api.next(seen, filter)),
      pick: api.pick,
      setFavorite: api.setFavorite,
    }),
    [api, filter, random],
  );

  const apply = (next: TasteFilter) => {
    setFilter(next);
    setRandom(false);
    setRound((r) => r + 1);
    setSheetOpen(false);
  };
  const showRandom = () => {
    setRandom(true);
    setRound((r) => r + 1);
    setSheetOpen(false);
  };
  const filtered = !isFilterEmpty(filter);

  return (
    <>
      <div className="row">
        <button
          type="button"
          className="btn grow"
          data-testid="open-mood"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}
        >
          今日の気分
        </button>
        <Link className="btn" href="/taste" data-testid="go-taste">
          嫌いな食材
        </Link>
      </div>

      {sheetOpen && (
        <MoodSheet
          api={api}
          initial={filter}
          onApply={apply}
          onRandom={showRandom}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {random && (
        <p className="row" data-testid="random-mode">
          <span className="grow">おまかせで表示中（絞り込みなし）</span>
          <button
            type="button"
            className="btn small"
            data-testid="random-back"
            onClick={() => apply(filter)}
          >
            候補にもどる
          </button>
        </p>
      )}
      {!random && filtered && (
        <p className="row" data-testid="active-filter">
          <span className="grow">絞り込み中：{filterSummary(filter)}</span>
          <button
            type="button"
            className="btn small"
            data-testid="clear-filter"
            onClick={() => apply(EMPTY_FILTER)}
          >
            解除
          </button>
        </p>
      )}

      <SuggestionDeck
        key={round}
        api={deckApi}
        emptyHelp={emptyHelp}
        noMatchHelp={
          <div className="row">
            <button
              type="button"
              className="btn primary"
              data-testid="no-match-change"
              onClick={() => setSheetOpen(true)}
            >
              条件を変える
            </button>
            <button
              type="button"
              className="btn"
              data-testid="no-match-random"
              onClick={showRandom}
            >
              おまかせ
            </button>
            <a
              className="btn"
              data-testid="no-match-outside"
              href={youtubeSearchUrl(filter)}
              target="_blank"
              rel="noopener noreferrer"
            >
              外で探す
            </a>
          </div>
        }
        excludedHelp={
          <Link className="btn primary" href="/taste" data-testid="excluded-review">
            好き嫌いの登録を見直す
          </Link>
        }
      />
    </>
  );
}
