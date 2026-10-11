// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SuggestionDeck, type DeckApi, type NextResult } from '../SuggestionDeck';
import type { DishDto } from '../types';

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

/** サーバーの代わり：見た ID と選んだものを除いて、順番に 1 件ずつ返す */
function fakeApi(dishes: DishDto[]) {
  const picked = new Set<string>();
  const calls: string[][] = [];
  const api: DeckApi = {
    next: vi.fn(async (seen: string[]): Promise<NextResult> => {
      calls.push([...seen]);
      if (dishes.length === 0) return { status: 'empty' };
      const rest = dishes.filter((d) => !seen.includes(d.id) && !picked.has(d.id));
      return rest.length
        ? { status: 'card', dish: rest[0], remaining: rest.length - 1 }
        : { status: 'done' };
    }),
    pick: vi.fn(async (id: string) => {
      picked.add(id);
    }),
    setFavorite: vi.fn(async (id: string, flag: boolean) => ({
      ...dishes.find((d) => d.id === id)!,
      isFavorite: flag,
    })),
  };
  return { api, calls, picked };
}

// jsdom の PointerEvent は座標を持たないので、MouseEvent を土台にした代用品を使う（実ブラウザには不要）
if (!('clientX' in (window.PointerEvent?.prototype ?? {}))) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, 'PointerEvent', {
    value: PointerEventPolyfill,
    configurable: true,
  });
}

const swipe = (el: HTMLElement, from: number, to: number) => {
  fireEvent.pointerDown(el, { clientX: from, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: to, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: to, pointerId: 1 });
};

describe('買い物前の候補', () => {
  it('最初の候補をカードで見せる（料理名、調理時間・手間、タグ、元の投稿を開く入口）', async () => {
    const { api } = fakeApi([dish('a')]);
    render(<SuggestionDeck api={api} />);
    expect(await screen.findByTestId('dish-name')).toHaveTextContent('料理a');
    expect(screen.getByTestId('dish-meta')).toHaveTextContent('15分以内・楽');
    expect(screen.getByTestId('dish-tags')).toHaveTextContent('さっぱり');
    const link = screen.getByTestId('open-original');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.queryByTestId('no-ingredients')).not.toBeInTheDocument();
  });

  it('材料が未入力の料理には「材料が未入力」を出す', async () => {
    const { api } = fakeApi([dish('a', { ingredients: [] })]);
    render(<SuggestionDeck api={api} />);
    expect(await screen.findByTestId('no-ingredients')).toHaveTextContent('材料が未入力');
  });

  it('http/https 以外の URL はリンクにしない（二重の防御）', async () => {
    const { api } = fakeApi([dish('a', { url: 'javascript:alert(1)' })]);
    render(<SuggestionDeck api={api} />);
    await screen.findByTestId('dish-name');
    expect(screen.queryByTestId('open-original')).not.toBeInTheDocument();
  });

  it('「これにする」ボタン：選んで次の候補へ。見た一覧に加わる', async () => {
    const { api, calls } = fakeApi([dish('a'), dish('b')]);
    render(<SuggestionDeck api={api} />);
    await screen.findByText('料理a');
    fireEvent.click(screen.getByTestId('pick-button'));
    expect(await screen.findByText('料理b')).toBeInTheDocument();
    expect(api.pick).toHaveBeenCalledWith('a');
    expect(calls.at(-1)).toEqual(['a']);
  });

  it('「パス」ボタン：選ばずに次の候補へ。パスした料理は再び出ない', async () => {
    const { api, calls } = fakeApi([dish('a'), dish('b')]);
    render(<SuggestionDeck api={api} />);
    await screen.findByText('料理a');
    fireEvent.click(screen.getByTestId('pass-button'));
    expect(await screen.findByText('料理b')).toBeInTheDocument();
    expect(api.pick).not.toHaveBeenCalled();
    expect(calls.at(-1)).toEqual(['a']);
  });

  it('右スワイプはボタン「これにする」と、左スワイプは「パス」と同じ結果（BR4.9）', async () => {
    // ボタンの結果
    const viaButton = fakeApi([dish('a'), dish('b')]);
    const r1 = render(<SuggestionDeck api={viaButton.api} />);
    await screen.findByText('料理a');
    fireEvent.click(screen.getByTestId('pick-button'));
    await screen.findByText('料理b');
    fireEvent.click(screen.getByTestId('pass-button'));
    await screen.findByTestId('done-message');
    r1.unmount();

    // スワイプの結果
    const viaSwipe = fakeApi([dish('a'), dish('b')]);
    render(<SuggestionDeck api={viaSwipe.api} />);
    await screen.findByText('料理a');
    swipe(screen.getByTestId('swipe-area'), 100, 220);
    await screen.findByText('料理b');
    swipe(screen.getByTestId('swipe-area'), 220, 100);
    await screen.findByTestId('done-message');

    expect(viaSwipe.api.pick).toHaveBeenCalledTimes(1);
    expect(viaSwipe.api.pick).toHaveBeenCalledWith('a');
    expect([...viaSwipe.picked]).toEqual([...viaButton.picked]);
    expect(viaSwipe.calls).toEqual(viaButton.calls);
  });

  it('短いスワイプでは何も起きない。キーボードの矢印でも操作できる', async () => {
    const { api } = fakeApi([dish('a'), dish('b')]);
    render(<SuggestionDeck api={api} />);
    await screen.findByText('料理a');
    swipe(screen.getByTestId('swipe-area'), 100, 140);
    expect(screen.getByText('料理a')).toBeInTheDocument();
    expect(api.pick).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId('swipe-area'), { key: 'ArrowRight' });
    await screen.findByText('料理b');
    expect(api.pick).toHaveBeenCalledWith('a');
  });

  it('全部見ると「見終えました」。「最初から見る」で見た一覧が空になり、選んだもの以外が戻る', async () => {
    const { api, calls } = fakeApi([dish('a'), dish('b')]);
    render(<SuggestionDeck api={api} />);
    await screen.findByText('料理a');
    fireEvent.click(screen.getByTestId('pick-button')); // a を選ぶ
    await screen.findByText('料理b');
    fireEvent.click(screen.getByTestId('pass-button')); // b をパス
    expect(await screen.findByTestId('done-message')).toHaveTextContent('見終えました');
    fireEvent.click(screen.getByTestId('restart-button'));
    // 見た一覧は空になる。選んだ a は除かれ、パスした b が戻る
    expect(await screen.findByText('料理b')).toBeInTheDocument();
    expect(calls.at(-1)).toEqual([]);
  });

  it('保存が 0 件なら案内を出す', async () => {
    const { api } = fakeApi([]);
    render(<SuggestionDeck api={api} emptyHelp={<span data-testid="help">保存の入口</span>} />);
    expect(await screen.findByTestId('empty-message')).toHaveTextContent('まだ保存がありません');
    expect(screen.getByTestId('help')).toBeInTheDocument();
  });

  it('お気に入りのボタンで印が切り替わる', async () => {
    const { api } = fakeApi([dish('a')]);
    render(<SuggestionDeck api={api} />);
    const fav = await screen.findByTestId('fav-button');
    expect(fav).toHaveAttribute('aria-label', 'お気に入りにする');
    fireEvent.click(fav);
    await waitFor(() =>
      expect(screen.getByTestId('fav-button')).toHaveAttribute('aria-label', 'お気に入りから外す'),
    );
  });

  it('読み込みに失敗したら、やり直せる', async () => {
    const api: DeckApi = {
      next: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ status: 'done' }),
      pick: vi.fn(),
    };
    render(<SuggestionDeck api={api} />);
    expect(await screen.findByTestId('deck-error')).toBeInTheDocument();
    fireEvent.click(screen.getByText('もう一度読み込む'));
    expect(await screen.findByTestId('done-message')).toBeInTheDocument();
  });

  it('操作要素にラベルがある（ボタンの名前、スワイプ領域の説明）', async () => {
    const { api } = fakeApi([dish('a')]);
    render(<SuggestionDeck api={api} />);
    await screen.findByText('料理a');
    expect(screen.getByRole('button', { name: /これにする/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /パス/ })).toBeInTheDocument();
    expect(screen.getByTestId('swipe-area')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('ボタンでも同じ操作'),
    );
  });
});
