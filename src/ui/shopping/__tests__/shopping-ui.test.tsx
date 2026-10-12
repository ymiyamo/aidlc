// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const apiMock = vi.fn();
vi.mock('../../api-client', async (orig) => {
  const actual = await orig<typeof import('../../api-client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

import { ApiError } from '../../api-client';
import { ShoppingListPanel } from '../ShoppingListPanel';
import { itemText, orderItems, type ShoppingItemDto, type ShoppingListDto } from '../types';

const item = (over: Partial<ShoppingItemDto> = {}): ShoppingItemDto => ({
  itemId: 'i1',
  kind: 'ingredient',
  ingredientName: '玉ねぎ',
  unit: '個',
  amountLabel: '3',
  dishes: [
    { dishId: 'd1', name: '肉じゃが', deleted: false },
    { dishId: 'd2', name: 'カレー', deleted: false },
  ],
  checked: false,
  checkedByLabel: null,
  checkedAt: null,
  ...over,
});

const list = (items: ShoppingItemDto[], over: Partial<ShoppingListDto> = {}): ShoppingListDto => ({
  listId: 'l1',
  source: 'picked',
  planId: null,
  status: 'active',
  empty: items.length === 0,
  stale: false,
  completedAt: null,
  completedByLabel: null,
  items,
  ...over,
});

const onion = item();
const salt = item({
  itemId: 'i2',
  ingredientName: '塩',
  unit: '',
  amountLabel: '少々',
  dishes: [{ dishId: 'd1', name: '肉じゃが', deleted: false }],
});
const soy = item({
  itemId: 'i3',
  ingredientName: '醤油',
  unit: '',
  amountLabel: '',
  dishes: [{ dishId: 'd1', name: '肉じゃが', deleted: false }],
});
const needs = item({
  itemId: 'i4',
  kind: 'needsInput',
  ingredientName: null,
  unit: '',
  amountLabel: '',
  dishes: [{ dishId: 'd9', name: '冷奴', deleted: false }],
});

type Handler = (method: string, path: string, body?: unknown) => unknown;
function routeApi(handler: Handler) {
  apiMock.mockImplementation(async (method: string, path: string, body?: unknown) => {
    const r = handler(method, path, body);
    if (r instanceof Error) throw r;
    return r;
  });
}
const calls = (method: string, path: string) =>
  apiMock.mock.calls.filter((c) => c[0] === method && c[1] === path);

beforeEach(() => {
  apiMock.mockReset();
});
afterEach(cleanup);

describe('表示の補助', () => {
  it('行の文言：「玉ねぎ 3個」「塩 少々」「醤油」', () => {
    expect(itemText(onion)).toBe('玉ねぎ 3個');
    expect(itemText(salt)).toBe('塩 少々');
    expect(itemText(soy)).toBe('醤油');
  });

  it('並びは、入力が必要 → チェックなし → チェックあり。同じ区分の中は元の順を保つ', () => {
    const a = item({ itemId: 'a', checked: true });
    const b = item({ itemId: 'b' });
    const c = item({ itemId: 'c' });
    expect(orderItems([a, b, needs, c]).map((i) => i.itemId)).toEqual(['i4', 'b', 'c', 'a']);
  });
});

describe('買い物リストの画面', () => {
  it('材料の行と元の料理を表示し、何件チェック済みかを出す', async () => {
    routeApi(() => ({ list: list([onion, salt, soy]) }));
    render(<ShoppingListPanel />);
    const rows = await screen.findAllByTestId('shopping-item');
    expect(rows).toHaveLength(3);
    const onionRow = rows.find((r) => within(r).queryByText('玉ねぎ 3個'))!;
    expect(within(onionRow).getByTestId('shopping-item-text').textContent).toBe('玉ねぎ 3個');
    expect(onionRow.textContent).toContain('肉じゃが、カレー');
    expect(screen.getByTestId('shopping-progress').textContent).toContain('3 件中 0 件');
    // ラベルがあるので、名前でチェックボックスを探せる
    expect(screen.getByRole('checkbox', { name: /塩 少々/ })).toBeTruthy();
    expect(calls('GET', '/api/shopping-list')).toHaveLength(1);
  });

  it('チェックを付けると保存され、下に移る。外すと元の位置に戻る', async () => {
    routeApi((method, path, body) => {
      if (method === 'GET') return { list: list([onion, salt]) };
      const checked = (body as { checked: boolean }).checked;
      const id = path.split('/')[4];
      return { item: { ...(id === 'i1' ? onion : salt), checked } };
    });
    render(<ShoppingListPanel />);
    // 材料名の順（文字コード順）で「塩」「玉ねぎ」になる
    await screen.findAllByTestId('shopping-check');
    expect(screen.getAllByTestId('shopping-item-text').map((e) => e.textContent)).toEqual([
      '塩 少々',
      '玉ねぎ 3個',
    ]);
    fireEvent.click(screen.getByRole('checkbox', { name: /塩 少々/ }));

    await waitFor(() =>
      expect(screen.getByTestId('shopping-progress').textContent).toContain('2 件中 1 件'),
    );
    expect(calls('PUT', '/api/shopping-list/items/i2/checked')[0][2]).toEqual({ checked: true });
    let texts = screen.getAllByTestId('shopping-item-text').map((e) => e.textContent);
    expect(texts).toEqual(['玉ねぎ 3個', '塩 少々']);
    expect((screen.getByRole('checkbox', { name: /塩 少々/ }) as HTMLInputElement).checked).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /塩 少々/ }));
    await waitFor(() =>
      expect(screen.getByTestId('shopping-progress').textContent).toContain('2 件中 0 件'),
    );
    expect(calls('PUT', '/api/shopping-list/items/i2/checked')[1][2]).toEqual({ checked: false });
    texts = screen.getAllByTestId('shopping-item-text').map((e) => e.textContent);
    expect(texts).toEqual(['塩 少々', '玉ねぎ 3個']);
  });

  it('保存できなかったときは、チェックを元に戻して知らせる', async () => {
    routeApi((method) => {
      if (method === 'GET') return { list: list([onion]) };
      return new ApiError(500, 'internal', 'エラー');
    });
    render(<ShoppingListPanel />);
    fireEvent.click(await screen.findByTestId('shopping-check'));
    expect((await screen.findByTestId('shopping-action-error')).textContent).toBe(
      '保存できませんでした',
    );
    expect((screen.getByTestId('shopping-check') as HTMLInputElement).checked).toBe(false);
  });

  it('チェックできない状態（409）のときは、その知らせを出して元に戻す', async () => {
    routeApi((method) => {
      if (method === 'GET') return { list: list([onion]) };
      return new ApiError(409, 'LIST_COMPLETED', 'チェックできません');
    });
    render(<ShoppingListPanel />);
    fireEvent.click(await screen.findByTestId('shopping-check'));
    expect((await screen.findByTestId('shopping-action-error')).textContent).toBe(
      'チェックできません',
    );
    expect((screen.getByTestId('shopping-check') as HTMLInputElement).checked).toBe(false);
  });

  it('選んだものが 0 件のときは、空の案内と候補を見る画面への入口を出す。買い物おわりは出さない（BR20.12）', async () => {
    routeApi(() => ({ list: list([]) }));
    render(<ShoppingListPanel />);
    const empty = await screen.findByTestId('shopping-empty');
    expect(empty.textContent).toContain('買い物リストは空です');
    expect(within(empty).getByRole('link', { name: '買い物前を開く' }).getAttribute('href')).toBe(
      '/suggest',
    );
    expect(screen.queryByTestId('shopping-complete-button')).toBeNull();
  });

  it('材料が未入力の料理は「材料の入力が必要」と案内し、チェックできない。入力画面への入口がある（BR20.8）', async () => {
    routeApi(() => ({ list: list([needs, onion]) }));
    render(<ShoppingListPanel />);
    const row = await screen.findByTestId('shopping-needs-input');
    expect(row.textContent).toContain('冷奴');
    expect(row.textContent).toContain('材料の入力が必要');
    expect(within(row).queryByRole('checkbox')).toBeNull();
    expect(within(row).getByRole('link', { name: '材料を入力する' }).getAttribute('href')).toBe(
      '/dishes/d9',
    );
    // 入力が必要な行だけでも、空の案内にはならない
    expect(screen.queryByTestId('shopping-empty')).toBeNull();
    expect(screen.getAllByTestId('shopping-check')).toHaveLength(1);
  });

  it('削除済みの料理の行には、入力画面への入口を出さない', async () => {
    const gone = item({
      ...needs,
      itemId: 'i5',
      dishes: [{ dishId: 'd8', name: '削除された料理', deleted: true }],
    });
    routeApi(() => ({ list: list([gone]) }));
    render(<ShoppingListPanel />);
    const row = await screen.findByTestId('shopping-needs-input');
    expect(row.textContent).toContain('削除された料理');
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('買い物おわり：確認のあとだけ完了し、リストを読み直す。やめるときは何も送らない', async () => {
    let completed = false;
    routeApi((method, path) => {
      if (method === 'POST' && path === '/api/shopping-list/complete') {
        completed = true;
        return { alreadyCompleted: false, unpickPending: false };
      }
      return { list: completed ? list([]) : list([onion]) };
    });
    render(<ShoppingListPanel />);
    fireEvent.click(await screen.findByTestId('shopping-complete-button'));
    expect(screen.getByTestId('shopping-complete-confirm-box')).toBeTruthy();

    fireEvent.click(screen.getByTestId('shopping-complete-cancel'));
    expect(screen.queryByTestId('shopping-complete-confirm-box')).toBeNull();
    expect(calls('POST', '/api/shopping-list/complete')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('shopping-complete-button'));
    fireEvent.click(screen.getByTestId('shopping-complete-confirm'));
    expect((await screen.findByTestId('shopping-done')).textContent).toContain(
      '選んだものを整理しました',
    );
    await waitFor(() => expect(screen.getByTestId('shopping-empty')).toBeTruthy());
    expect(calls('POST', '/api/shopping-list/complete')).toHaveLength(1);
    expect(calls('GET', '/api/shopping-list')).toHaveLength(2);
    expect(screen.queryByTestId('shopping-complete-confirm-box')).toBeNull();
  });

  it('外し残しがあるときは、次に開くときにやり直すと知らせる', async () => {
    routeApi((method, path) =>
      method === 'POST' && path === '/api/shopping-list/complete'
        ? { alreadyCompleted: false, unpickPending: true }
        : { list: list([onion]) },
    );
    render(<ShoppingListPanel />);
    fireEvent.click(await screen.findByTestId('shopping-complete-button'));
    fireEvent.click(screen.getByTestId('shopping-complete-confirm'));
    expect((await screen.findByTestId('shopping-done')).textContent).toContain('やり直します');
  });

  it('完了に失敗したときは知らせ、確認の画面を残す', async () => {
    routeApi((method) =>
      method === 'POST' ? new ApiError(500, 'internal', 'エラー') : { list: list([onion]) },
    );
    render(<ShoppingListPanel />);
    fireEvent.click(await screen.findByTestId('shopping-complete-button'));
    fireEvent.click(screen.getByTestId('shopping-complete-confirm'));
    expect((await screen.findByTestId('shopping-action-error')).textContent).toContain(
      '買い物おわりにできませんでした',
    );
    expect(screen.queryByTestId('shopping-done')).toBeNull();
    expect(screen.getByTestId('shopping-complete-confirm-box')).toBeTruthy();
  });

  it('最新の状態にできなかったときは、前回保存した内容と知らせを出す（BR20.3）', async () => {
    routeApi(() => ({ list: list([onion], { stale: true }) }));
    render(<ShoppingListPanel />);
    expect((await screen.findByTestId('shopping-stale')).textContent).toContain(
      '最新の状態にできませんでした',
    );
    expect(screen.getAllByTestId('shopping-item')).toHaveLength(1);
  });

  it('読み込めなかったときはエラーを出す', async () => {
    routeApi(() => new ApiError(500, 'internal', 'エラー'));
    render(<ShoppingListPanel />);
    expect((await screen.findByTestId('shopping-error')).textContent).toContain(
      '読み込めませんでした',
    );
  });
});
