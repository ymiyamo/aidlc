// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ApiError } from '../../api-client';
import type { NextResult } from '../../SuggestionDeck';
import type { DishDto } from '../../types';
import type { DislikeApi, TasteSuggestApi } from '../api';
import { DislikesPanel } from '../DislikesPanel';
import { TasteSuggest, filterSummary } from '../TasteSuggest';
import {
  EMPTY_FILTER,
  filterParams,
  isFilterEmpty,
  type DislikeDto,
  type TasteFilter,
} from '../types';

afterEach(cleanup);

const dish = (id: string, over: Partial<DishDto> = {}): DishDto => ({
  id,
  name: `料理${id}`,
  url: `https://example.com/${id}`,
  cookTime: 'within15',
  effort: 'easy',
  moodTags: ['さっぱり'],
  ingredients: [{ name: '卵', amount: '2', unit: '個' }],
  memo: null,
  isFavorite: false,
  source: 'user',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const card = (id: string): NextResult => ({ status: 'card', dish: dish(id), remaining: 0 });

/** サーバーの代わり：条件ごとに返す結果を決められる */
function fakeApi(over: Partial<TasteSuggestApi> = {}) {
  const api: TasteSuggestApi = {
    next: vi.fn(async (): Promise<NextResult> => card('a')),
    random: vi.fn(async (): Promise<NextResult> => card('r')),
    count: vi.fn(async () => 12),
    moodTags: vi.fn(async () => ['さっぱり', 'がっつり']),
    pick: vi.fn(async () => {}),
    ...over,
  };
  return api;
}

const lastFilter = (api: TasteSuggestApi): TasteFilter => vi.mocked(api.next).mock.calls.at(-1)![1];
const lastSeen = (api: TasteSuggestApi): string[] => vi.mocked(api.next).mock.calls.at(-1)![0];

/** 件数の数え直しが終わるまで待つ（終わる前にテストを終えると、描画の更新が作法の外になる） */
const settle = (sheet: HTMLElement) =>
  waitFor(() =>
    expect(within(sheet).getByTestId('mood-count')).not.toHaveTextContent('数えています'),
  );

async function openSheet() {
  fireEvent.click(await screen.findByTestId('open-mood'));
  const sheet = await screen.findByTestId('mood-sheet');
  await settle(sheet);
  return sheet;
}

describe('条件の型（BR10.14）', () => {
  it('指定していない項目は問い合わせに付けない。タグは繰り返しで渡す', () => {
    expect(filterParams(EMPTY_FILTER).toString()).toBe('');
    expect(
      filterParams({ cookTime: 'over30', effort: null, moodTags: ['さっぱり', 'がっつり'] }).getAll(
        'moodTag',
      ),
    ).toEqual(['さっぱり', 'がっつり']);
    expect(filterParams({ cookTime: 'within15', effort: 'easy', moodTags: [] }).toString()).toBe(
      'time=within15&effort=easy',
    );
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
    expect(isFilterEmpty({ ...EMPTY_FILTER, effort: 'hard' })).toBe(false);
    expect(filterSummary({ cookTime: 'within15', effort: 'easy', moodTags: ['さっぱり'] })).toBe(
      '15分以内・楽・さっぱり',
    );
  });
});

describe('「今日の気分」のシート（BR10.10、BR10.13、BR10.15）', () => {
  it('買い物前から開ける。調理時間・手間・気分のタグの選択肢がすべて見える。条件なしで件数が出る', async () => {
    const api = fakeApi();
    render(<TasteSuggest api={api} />);
    expect(await screen.findByTestId('dish-name')).toHaveTextContent('料理a');
    const sheet = await openSheet();
    for (const t of ['15分以内', '30分以内', 'それ以上', '楽', 'ふつう', '頑張れる']) {
      expect(within(sheet).getByRole('button', { name: t })).toBeInTheDocument();
    }
    expect(await within(sheet).findByTestId('mood-tag-さっぱり')).toBeInTheDocument();
    expect(within(sheet).getByTestId('mood-tag-がっつり')).toBeInTheDocument();
    expect(await within(sheet).findByTestId('mood-count')).toHaveTextContent(
      '条件に合う料理：12件',
    );
  });

  it('選択肢は折り返して並べる（横にスクロールしない。.row は flex-wrap）', async () => {
    render(<TasteSuggest api={fakeApi()} />);
    const sheet = await openSheet();
    await within(sheet).findByTestId('mood-tags');
    for (const el of [
      within(sheet).getByTestId('mood-time-within15').parentElement,
      within(sheet).getByTestId('mood-effort-easy').parentElement,
      within(sheet).getByTestId('mood-tags'),
    ]) {
      expect(el).toHaveClass('row');
    }
  });

  it('調理時間・手間は 1 つだけ（選び直すと切り替わり、もう一度押すと外れる）。タグは複数選べる。選んだものに印が付く', async () => {
    render(<TasteSuggest api={fakeApi()} />);
    const sheet = await openSheet();
    const pressed = (id: string) => within(sheet).getByTestId(id).getAttribute('aria-pressed');
    fireEvent.click(within(sheet).getByTestId('mood-time-within15'));
    fireEvent.click(within(sheet).getByTestId('mood-time-over30'));
    expect(pressed('mood-time-within15')).toBe('false');
    expect(pressed('mood-time-over30')).toBe('true');
    fireEvent.click(within(sheet).getByTestId('mood-time-over30'));
    expect(pressed('mood-time-over30')).toBe('false');
    fireEvent.click(within(sheet).getByTestId('mood-effort-easy'));
    fireEvent.click(within(sheet).getByTestId('mood-effort-hard'));
    expect(pressed('mood-effort-easy')).toBe('false');
    expect(pressed('mood-effort-hard')).toBe('true');
    fireEvent.click(await within(sheet).findByTestId('mood-tag-さっぱり'));
    fireEvent.click(within(sheet).getByTestId('mood-tag-がっつり'));
    expect(pressed('mood-tag-さっぱり')).toBe('true');
    expect(pressed('mood-tag-がっつり')).toBe('true');
    await settle(sheet);
  });

  it('条件を選ぶたびに件数を数え直して表示する。一致する件数を渡す', async () => {
    const api = fakeApi({
      count: vi.fn(async (f: TasteFilter) =>
        f.cookTime === 'within15' && f.effort === 'easy' ? 3 : f.cookTime ? 7 : 12,
      ),
    });
    render(<TasteSuggest api={api} />);
    const sheet = await openSheet();
    await waitFor(() => expect(within(sheet).getByTestId('mood-count')).toHaveTextContent('12件'));
    fireEvent.click(within(sheet).getByTestId('mood-time-within15'));
    await waitFor(() => expect(within(sheet).getByTestId('mood-count')).toHaveTextContent('7件'));
    fireEvent.click(within(sheet).getByTestId('mood-effort-easy'));
    await waitFor(() => expect(within(sheet).getByTestId('mood-count')).toHaveTextContent('3件'));
    expect(vi.mocked(api.count).mock.calls.at(-1)![0]).toEqual({
      cookTime: 'within15',
      effort: 'easy',
      moodTags: [],
    });
  });

  it('件数を数えられなくても、条件の選択と「見る」は使える', async () => {
    const api = fakeApi({ count: vi.fn(async () => Promise.reject(new Error('x'))) });
    render(<TasteSuggest api={api} />);
    const sheet = await openSheet();
    expect(await within(sheet).findByText('件数を数えられませんでした')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByTestId('mood-effort-easy'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    await waitFor(() => expect(lastFilter(api).effort).toBe('easy'));
  });

  it('タグ付きの料理がなければ、その旨を出す', async () => {
    render(<TasteSuggest api={fakeApi({ moodTags: vi.fn(async () => []) })} />);
    const sheet = await openSheet();
    expect(await within(sheet).findByTestId('mood-tags-empty')).toBeInTheDocument();
  });

  it('「条件をリセット」で全部外れる。条件がなければ押せない', async () => {
    render(<TasteSuggest api={fakeApi()} />);
    const sheet = await openSheet();
    const reset = within(sheet).getByTestId('mood-reset');
    expect(reset).toBeDisabled();
    fireEvent.click(within(sheet).getByTestId('mood-time-within30'));
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(within(sheet).getByTestId('mood-time-within30')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(reset).toBeDisabled();
    await settle(sheet);
  });

  it('「閉じる」で閉じる。操作要素に名前がある', async () => {
    render(<TasteSuggest api={fakeApi()} />);
    const sheet = await openSheet();
    expect(screen.getByRole('region', { name: '今日の気分' })).toBe(sheet);
    expect(within(sheet).getByRole('group', { name: /調理時間/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('group', { name: /手間/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: '見る' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByTestId('mood-close'));
    expect(screen.queryByTestId('mood-sheet')).not.toBeInTheDocument();
  });
});

describe('「見る」で絞り込んだ候補（BR10.14）', () => {
  it('条件つきで候補を取り直し、見た料理の一覧を空にして最初から出す。シートは閉じ、条件の要約が出る', async () => {
    const api = fakeApi({
      next: vi.fn(async (seen: string[]) => (seen.length === 0 ? card('a') : card('b'))),
    });
    render(<TasteSuggest api={api} />);
    await screen.findByText('料理a');
    fireEvent.click(screen.getByTestId('pass-button')); // a をパス → 見た一覧に a
    await screen.findByText('料理b');
    expect(lastSeen(api)).toEqual(['a']);

    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-time-within15'));
    fireEvent.click(within(sheet).getByTestId('mood-effort-easy'));
    fireEvent.click(await within(sheet).findByTestId('mood-tag-さっぱり'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));

    await waitFor(() => expect(lastSeen(api)).toEqual([]));
    expect(lastFilter(api)).toEqual({
      cookTime: 'within15',
      effort: 'easy',
      moodTags: ['さっぱり'],
    });
    expect(await screen.findByText('料理a')).toBeInTheDocument();
    expect(screen.queryByTestId('mood-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-filter')).toHaveTextContent('15分以内・楽・さっぱり');
  });

  it('同じ条件でもう一度「見る」を押すと、最初から出し直す', async () => {
    const api = fakeApi();
    render(<TasteSuggest api={api} />);
    await screen.findByText('料理a');
    fireEvent.click(screen.getByTestId('pass-button'));
    await waitFor(() => expect(lastSeen(api)).toEqual(['a']));
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    await waitFor(() => expect(lastSeen(api)).toEqual([]));
  });

  it('条件を空にして「見る」を押す・「解除」を押すと、絞り込みなしに戻る', async () => {
    const api = fakeApi();
    render(<TasteSuggest api={api} />);
    await screen.findByText('料理a');
    let sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-effort-hard'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    await waitFor(() => expect(lastFilter(api).effort).toBe('hard'));

    sheet = await openSheet();
    expect(within(sheet).getByTestId('mood-effort-hard')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sheet).getByTestId('mood-reset'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    await waitFor(() => expect(lastFilter(api)).toEqual(EMPTY_FILTER));
    expect(screen.queryByTestId('active-filter')).not.toBeInTheDocument();

    sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-time-over30'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    await screen.findByTestId('active-filter');
    fireEvent.click(screen.getByTestId('clear-filter'));
    await waitFor(() => expect(lastFilter(api)).toEqual(EMPTY_FILTER));
    expect(screen.queryByTestId('active-filter')).not.toBeInTheDocument();
  });

  it('絞り込み中も「これにする」で選べる', async () => {
    const api = fakeApi();
    render(<TasteSuggest api={api} />);
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-effort-easy'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    await screen.findByTestId('active-filter');
    fireEvent.click(await screen.findByTestId('pick-button'));
    await waitFor(() => expect(api.pick).toHaveBeenCalledWith('a'));
  });
});

describe('絞り込みで 0 件の案内（BR10.19）', () => {
  const noMatch = async (): Promise<NextResult> => ({ status: 'no_match' });

  it('「絞り込みを緩めてみてください」と、「条件を変える」「おまかせ」「外で探す」を出す', async () => {
    const api = fakeApi({ next: vi.fn(noMatch) });
    render(<TasteSuggest api={api} />);
    const msg = await screen.findByTestId('no-match-message');
    expect(msg).toHaveTextContent('条件に合う料理がありません');
    expect(msg).toHaveTextContent('絞り込みを緩めてみてください');
    expect(within(msg).getByTestId('no-match-change')).toBeInTheDocument();
    expect(within(msg).getByTestId('no-match-random')).toBeInTheDocument();
    expect(within(msg).getByTestId('no-match-outside')).toBeInTheDocument();
    // 「見終えました」の案内とは別
    expect(screen.queryByTestId('done-message')).not.toBeInTheDocument();
  });

  it('「条件を変える」でシートが開き、選んでいた条件が残っている', async () => {
    const api = fakeApi({
      next: vi.fn(async (_seen: string[], f: TasteFilter) =>
        f.cookTime ? { status: 'no_match' as const } : card('a'),
      ),
    });
    render(<TasteSuggest api={api} />);
    await screen.findByText('料理a');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-time-over30'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    fireEvent.click(await screen.findByTestId('no-match-change'));
    const again = await screen.findByTestId('mood-sheet');
    expect(within(again).getByTestId('mood-time-over30')).toHaveAttribute('aria-pressed', 'true');
    // 条件を空にして見ると、絞り込みなしの候補に戻る
    fireEvent.click(within(again).getByTestId('mood-reset'));
    fireEvent.click(within(again).getByTestId('mood-apply'));
    expect(await screen.findByText('料理a')).toBeInTheDocument();
  });

  it('「おまかせ」で絞り込みなしの 1 件を出す', async () => {
    const api = fakeApi({ next: vi.fn(noMatch) });
    render(<TasteSuggest api={api} />);
    fireEvent.click(await screen.findByTestId('no-match-random'));
    expect(await screen.findByText('料理r')).toBeInTheDocument();
    expect(api.random).toHaveBeenCalled();
  });

  it('「外で探す」は選んでいる条件の YouTube 検索画面を新しいタブで開くだけ（結果は取り込まない）', async () => {
    const api = fakeApi({
      next: vi.fn(async (_seen: string[], f: TasteFilter) =>
        f.cookTime ? { status: 'no_match' as const } : card('a'),
      ),
    });
    render(<TasteSuggest api={api} />);
    await screen.findByText('料理a');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-time-over30'));
    fireEvent.click(await within(sheet).findByTestId('mood-tag-がっつり'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    const link = await screen.findByTestId('no-match-outside');
    expect(link).toHaveAttribute(
      'href',
      `https://www.youtube.com/results?search_query=${encodeURIComponent('がっつり それ以上 レシピ')}`,
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
});

describe('外で探す（シート。BR10.17）', () => {
  it('シートで選んでいる条件のまま、検索の画面へのリンクになる。何も選ばなければ「レシピ」だけ', async () => {
    render(<TasteSuggest api={fakeApi()} />);
    const sheet = await openSheet();
    const link = within(sheet).getByTestId('mood-outside');
    expect(link).toHaveAttribute(
      'href',
      `https://www.youtube.com/results?search_query=${encodeURIComponent('レシピ')}`,
    );
    fireEvent.click(within(sheet).getByTestId('mood-time-within15'));
    fireEvent.click(await within(sheet).findByTestId('mood-tag-さっぱり'));
    expect(link).toHaveAttribute(
      'href',
      `https://www.youtube.com/results?search_query=${encodeURIComponent('さっぱり 15分以内 レシピ')}`,
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    await settle(sheet);
  });
});

describe('おまかせ（BR10.16）', () => {
  it('シートの「おまかせ」で、絞り込みなしの 1 件を出し、おまかせ表示中と分かる。「これにする」もできる', async () => {
    const api = fakeApi();
    render(<TasteSuggest api={api} />);
    await screen.findByText('料理a');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-effort-hard'));
    fireEvent.click(within(sheet).getByTestId('mood-random'));
    expect(await screen.findByText('料理r')).toBeInTheDocument();
    expect(screen.getByTestId('random-mode')).toHaveTextContent('おまかせ');
    expect(screen.queryByTestId('mood-sheet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pick-button'));
    await waitFor(() => expect(api.pick).toHaveBeenCalledWith('r'));
  });

  it('「候補にもどる」で、条件つきの候補に戻る', async () => {
    const api = fakeApi();
    render(<TasteSuggest api={api} />);
    await screen.findByText('料理a');
    let sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-effort-easy'));
    fireEvent.click(within(sheet).getByTestId('mood-apply'));
    await screen.findByTestId('active-filter');
    sheet = await openSheet();
    fireEvent.click(within(sheet).getByTestId('mood-random'));
    await screen.findByTestId('random-mode');
    expect(screen.queryByTestId('active-filter')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('random-back'));
    await screen.findByTestId('active-filter');
    expect(screen.queryByTestId('random-mode')).not.toBeInTheDocument();
    expect(lastFilter(api).effort).toBe('easy');
  });
});

describe('除外で候補がすべて外れたとき（BR10.20）', () => {
  it('嫌いな食材の見直しを案内し、好き嫌いの画面への入口を出す', async () => {
    const api = fakeApi({
      next: vi.fn(async (): Promise<NextResult> => ({ status: 'all_excluded' })),
    });
    render(<TasteSuggest api={api} />);
    const msg = await screen.findByTestId('all-excluded-message');
    expect(msg).toHaveTextContent('登録された嫌いな食材で、候補がすべて外れています');
    expect(within(msg).getByTestId('excluded-review')).toHaveAttribute('href', '/taste');
  });
});

describe('買い物前の入口と、U1 の動き', () => {
  it('「嫌いな食材」の画面への入口がある', async () => {
    render(<TasteSuggest api={fakeApi()} />);
    expect(await screen.findByTestId('go-taste')).toHaveAttribute('href', '/taste');
  });

  it('保存が 0 件なら U1 の案内（絞り込みの案内ではない）', async () => {
    const api = fakeApi({ next: vi.fn(async (): Promise<NextResult> => ({ status: 'empty' })) });
    render(<TasteSuggest api={api} emptyHelp={<span data-testid="help">保存の入口</span>} />);
    expect(await screen.findByTestId('empty-message')).toHaveTextContent('まだ保存がありません');
    expect(screen.getByTestId('help')).toBeInTheDocument();
    expect(screen.queryByTestId('no-match-message')).not.toBeInTheDocument();
  });

  it('条件なしでは、最初の取得に条件を付けない', async () => {
    const api = fakeApi();
    render(<TasteSuggest api={api} />);
    await screen.findByText('料理a');
    expect(vi.mocked(api.next).mock.calls[0]).toEqual([[], EMPTY_FILTER]);
  });
});

describe('嫌いな食材の画面（BR10.1〜BR10.5、BR10.24）', () => {
  const item = (id: string, ingredientName: string): DislikeDto => ({
    id,
    ingredientName,
    registeredAt: '2026-01-01T00:00:00Z',
  });

  function fakeDislikeApi(initial: DislikeDto[] = [], over: Partial<DislikeApi> = {}) {
    let items = [...initial];
    const api: DislikeApi = {
      list: vi.fn(async () => ({ dislikes: [...items], limit: 50 })),
      add: vi.fn(async (name: string) => {
        const d = item(`id-${items.length + 1}`, name.trim());
        items = [...items, d];
        return d;
      }),
      remove: vi.fn(async (id: string) => {
        items = items.filter((d) => d.id !== id);
      }),
      ...over,
    };
    return api;
  }

  it('アレルギーを防ぐものではない旨と、材料の文字のとおり入力する案内を常に出す', async () => {
    render(<DislikesPanel api={fakeDislikeApi()} />);
    expect(await screen.findByTestId('dislike-empty')).toBeInTheDocument();
    expect(screen.getByTestId('allergy-notice')).toHaveTextContent(
      '好き嫌いの登録は、アレルギーを防ぐものではありません',
    );
    expect(screen.getByTestId('dislike-help')).toHaveTextContent(
      '食材名は、材料に書かれた文字のとおり入力してください',
    );
    expect(screen.getByLabelText('嫌いな食材')).toHaveAccessibleDescription(/材料に書かれた文字/);
  });

  it('自分の登録が一覧に出る。件数も出る', async () => {
    render(<DislikesPanel api={fakeDislikeApi([item('1', 'えび'), item('2', 'ピーマン')])} />);
    const list = await screen.findByTestId('dislike-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('えび');
    expect(list).toHaveTextContent('ピーマン');
    expect(screen.getByTestId('dislike-count')).toHaveTextContent('2 / 50 件');
  });

  it('食材名を入れて登録すると、一覧に加わり、入力欄が空になる', async () => {
    const api = fakeDislikeApi();
    render(<DislikesPanel api={api} />);
    await screen.findByTestId('dislike-empty');
    fireEvent.change(screen.getByTestId('dislike-input'), { target: { value: 'えび' } });
    fireEvent.click(screen.getByTestId('dislike-submit'));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith('えび'));
    expect(await screen.findByTestId('dislike-list')).toHaveTextContent('えび');
    expect(screen.getByTestId('dislike-input')).toHaveValue('');
  });

  it('Enter キーでも登録できる（フォーム）', async () => {
    const api = fakeDislikeApi();
    render(<DislikesPanel api={api} />);
    await screen.findByTestId('dislike-empty');
    fireEvent.change(screen.getByTestId('dislike-input'), { target: { value: 'セロリ' } });
    fireEvent.submit(screen.getByTestId('dislike-form'));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith('セロリ'));
  });

  it('入力エラーは、入力を残したまま理由を出す（1〜50 文字）', async () => {
    const api = fakeDislikeApi([], {
      add: vi.fn(async () => {
        throw new ApiError(400, 'validation', '入力エラー', {
          ingredientName: '食材名は 1〜50 文字で入力してください',
        });
      }),
    });
    render(<DislikesPanel api={api} />);
    await screen.findByTestId('dislike-empty');
    fireEvent.change(screen.getByTestId('dislike-input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('dislike-submit'));
    const err = await screen.findByTestId('dislike-error');
    expect(err).toHaveTextContent('食材名は 1〜50 文字で入力してください');
    expect(err).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('dislike-input')).toHaveValue('   ');
    expect(screen.getByTestId('dislike-input')).toHaveAttribute('aria-invalid', 'true');
  });

  it('50 件に達していたら、その案内を出す', async () => {
    const api = fakeDislikeApi([], {
      add: vi.fn(async () => {
        throw new ApiError(400, 'validation', '入力エラー', {
          ingredientName: '登録できるのは 50 件までです。使わないものを外してください',
        });
      }),
    });
    render(<DislikesPanel api={api} />);
    await screen.findByTestId('dislike-empty');
    fireEvent.change(screen.getByTestId('dislike-input'), { target: { value: 'えび' } });
    fireEvent.click(screen.getByTestId('dislike-submit'));
    expect(await screen.findByTestId('dislike-error')).toHaveTextContent('50 件までです');
  });

  it('「外す」で解除できる。ボタンは食材名で読み上げられる', async () => {
    const api = fakeDislikeApi([item('1', 'えび'), item('2', 'ピーマン')]);
    render(<DislikesPanel api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '「えび」を外す' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(screen.getByTestId('dislike-list')).not.toHaveTextContent('えび'));
    expect(screen.getByTestId('dislike-list')).toHaveTextContent('ピーマン');
  });

  it('すでに外れていた（見つからない）ときは、エラーにせず一覧を読み直す', async () => {
    const api = fakeDislikeApi([item('1', 'えび')], {
      remove: vi.fn(async () => {
        throw new ApiError(404, 'not_found', '見つかりません');
      }),
    });
    render(<DislikesPanel api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '「えび」を外す' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('dislike-error')).not.toBeInTheDocument();
  });

  it('外すのに失敗したら、知らせる', async () => {
    const api = fakeDislikeApi([item('1', 'えび')], {
      remove: vi.fn(async () => {
        throw new ApiError(500, 'internal', 'エラー');
      }),
    });
    render(<DislikesPanel api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '「えび」を外す' }));
    expect(await screen.findByTestId('dislike-error')).toHaveTextContent('外せませんでした');
  });

  it('読み込みに失敗したら、知らせる', async () => {
    const api = fakeDislikeApi([], { list: vi.fn(async () => Promise.reject(new Error('x'))) });
    render(<DislikesPanel api={api} />);
    expect(await screen.findByTestId('dislike-load-error')).toBeInTheDocument();
  });
});
