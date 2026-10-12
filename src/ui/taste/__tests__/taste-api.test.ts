import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('../../api-client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  deckApi: { pick: vi.fn(), setFavorite: vi.fn() },
}));

import { dislikeApi, tasteSuggestApi } from '../api';
import { EMPTY_FILTER } from '../types';

beforeEach(() => apiMock.mockReset());

describe('画面から呼ぶ API の宛先（契約 C1）', () => {
  it('候補：条件なしは宛先だけ。条件と見た料理は問い合わせに付ける（time、effort、moodTag、seen）', async () => {
    apiMock.mockResolvedValue({ status: 'done' });
    await tasteSuggestApi.next([], EMPTY_FILTER);
    expect(apiMock).toHaveBeenLastCalledWith('GET', '/api/suggestions/next');

    await tasteSuggestApi.next(['a', 'b'], {
      cookTime: 'over30',
      effort: 'hard',
      moodTags: ['さっぱり', 'がっつり'],
    });
    const path = apiMock.mock.calls.at(-1)![1] as string;
    const q = new URL(`http://x${path}`).searchParams;
    expect(path.startsWith('/api/suggestions/next?')).toBe(true);
    expect(q.get('time')).toBe('over30');
    expect(q.get('effort')).toBe('hard');
    expect(q.getAll('moodTag')).toEqual(['さっぱり', 'がっつり']);
    expect(q.get('seen')).toBe('a,b');
  });

  it('おまかせ・件数・タグの選択肢', async () => {
    apiMock.mockResolvedValue({ status: 'done' });
    await tasteSuggestApi.random();
    expect(apiMock).toHaveBeenLastCalledWith('GET', '/api/suggestions/random');

    apiMock.mockResolvedValue({ count: 4 });
    expect(await tasteSuggestApi.count({ ...EMPTY_FILTER, cookTime: 'within15' })).toBe(4);
    expect(apiMock).toHaveBeenLastCalledWith('GET', '/api/suggestions/count?time=within15');

    apiMock.mockResolvedValue({ tags: ['さっぱり'] });
    expect(await tasteSuggestApi.moodTags()).toEqual(['さっぱり']);
    expect(apiMock).toHaveBeenLastCalledWith('GET', '/api/suggestions/mood-tags');
  });

  it('嫌いな食材：一覧・登録・解除', async () => {
    apiMock.mockResolvedValue({ dislikes: [], limit: 50 });
    expect(await dislikeApi.list()).toEqual({ dislikes: [], limit: 50 });
    expect(apiMock).toHaveBeenLastCalledWith('GET', '/api/me/dislikes');

    const dislike = { id: 'x', ingredientName: 'えび', registeredAt: '' };
    apiMock.mockResolvedValue({ dislike });
    expect(await dislikeApi.add('えび')).toEqual(dislike);
    expect(apiMock).toHaveBeenLastCalledWith('POST', '/api/me/dislikes', {
      ingredientName: 'えび',
    });

    apiMock.mockResolvedValue({ ok: true });
    await dislikeApi.remove('x');
    expect(apiMock).toHaveBeenLastCalledWith('DELETE', '/api/me/dislikes/x');
  });
});
