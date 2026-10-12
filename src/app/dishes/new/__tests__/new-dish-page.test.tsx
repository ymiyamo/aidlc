// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/ui/api-client', async (orig) => {
  const actual = await orig<typeof import('@/ui/api-client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/ui/Shell', () => ({
  useSession: () => ({ id: 'me' }),
  Shell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { ApiError } from '@/ui/api-client';
import NewDishPage from '../page';

const DISH_ID = '22222222-2222-4222-8222-222222222222';
const fill = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
const choose = () =>
  fireEvent.change(screen.getByTestId('input-image'), {
    target: { files: [new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })] },
  });
const fillDish = () => {
  fill('input-url', 'https://example.com/x');
  fill('input-name', '料理');
};

beforeEach(() => {
  apiMock.mockReset();
  replace.mockReset();
});
afterEach(cleanup);

describe('料理を保存する画面（/dishes/new）と画像（R-01）', () => {
  it('選んだ画像は、保存した料理の ID で登録され、そのあとで一覧へ移る', async () => {
    const order: string[] = [];
    apiMock.mockImplementation(async (method: string, path: string) => {
      order.push(`${method} ${path}`);
      if (method === 'POST') return { dish: { id: DISH_ID } };
      return { image: { source: 'registered', status: 'ready', url: null } };
    });
    replace.mockImplementation(() => order.push('replace'));
    render(<NewDishPage />);
    fillDish();
    choose();
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dishes'));
    expect(order).toEqual(['POST /api/dishes', `PUT /api/dishes/${DISH_ID}/image`, 'replace']);
  });

  it('画像を選ばなければ、これまでどおり保存して一覧へ移る', async () => {
    apiMock.mockResolvedValue({ dish: { id: DISH_ID } });
    render(<NewDishPage />);
    fillDish();
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dishes'));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('画像が登録できなくても料理は保存済み。理由を出し、一覧へは移らず、編集の画面へ進める', async () => {
    apiMock.mockImplementation(async (method: string) => {
      if (method === 'POST') return { dish: { id: DISH_ID } };
      throw new ApiError(415, 'IMAGE_NOT_SUPPORTED', '入力エラー', {
        image: '画像ではありません。',
      });
    });
    render(<NewDishPage />);
    fillDish();
    choose();
    fireEvent.click(screen.getByTestId('submit-button'));
    const err = await screen.findByTestId('error-image');
    expect(err).toHaveTextContent('料理は保存しました');
    expect(err).toHaveTextContent('画像ではありません。');
    expect(replace).not.toHaveBeenCalled();
    // 料理を二重に作らない
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    expect(apiMock.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('open-edit-button'));
    expect(replace).toHaveBeenCalledWith(`/dishes/${DISH_ID}`);
  });
});
