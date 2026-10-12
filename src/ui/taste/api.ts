import { api, deckApi } from '../api-client';
import type { DeckApi, NextResult } from '../SuggestionDeck';
import { filterParams, type DislikeDto, type TasteFilter } from './types';

/** 買い物前の画面（今日の気分・おまかせ）が使う API（テストでは差し替える） */
export interface TasteSuggestApi extends Pick<DeckApi, 'pick' | 'setFavorite'> {
  /** 条件つきで候補を 1 件。見た料理の一覧は画面が持って毎回送る（BR10.14） */
  next(seen: string[], filter: TasteFilter): Promise<NextResult>;
  /** おまかせ：絞り込みなしで 1 件（BR10.16） */
  random(): Promise<NextResult>;
  /** いまの条件に合う件数（BR10.13） */
  count(filter: TasteFilter): Promise<number>;
  /** 気分のタグの選択肢（BR10.10） */
  moodTags(): Promise<string[]>;
}

/** 嫌いな食材の画面が使う API */
export interface DislikeApi {
  list(): Promise<{ dislikes: DislikeDto[]; limit: number }>;
  add(ingredientName: string): Promise<DislikeDto>;
  remove(id: string): Promise<void>;
}

const withQuery = (path: string, p: URLSearchParams) => {
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
};

export const tasteSuggestApi: TasteSuggestApi = {
  pick: deckApi.pick,
  setFavorite: deckApi.setFavorite,
  next(seen, filter) {
    const p = filterParams(filter);
    if (seen.length) p.set('seen', seen.join(','));
    return api<NextResult>('GET', withQuery('/api/suggestions/next', p));
  },
  random() {
    return api<NextResult>('GET', '/api/suggestions/random');
  },
  async count(filter) {
    const r = await api<{ count: number }>(
      'GET',
      withQuery('/api/suggestions/count', filterParams(filter)),
    );
    return r.count;
  },
  async moodTags() {
    return (await api<{ tags: string[] }>('GET', '/api/suggestions/mood-tags')).tags;
  },
};

export const dislikeApi: DislikeApi = {
  list() {
    return api('GET', '/api/me/dislikes');
  },
  async add(ingredientName) {
    return (await api<{ dislike: DislikeDto }>('POST', '/api/me/dislikes', { ingredientName }))
      .dislike;
  },
  async remove(id) {
    await api('DELETE', `/api/me/dislikes/${id}`);
  },
};
