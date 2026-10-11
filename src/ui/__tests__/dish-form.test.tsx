// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api-client';
import { DishForm, formatIngredientLines, parseIngredientLines } from '../DishForm';

const fill = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('保存の画面の検証の表示（BR3.1〜BR3.5）', () => {
  it('URL と料理名が空なら、項目ごとにエラーを出し、送信しない', async () => {
    const onSubmit = vi.fn();
    render(<DishForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('error-name')).toHaveTextContent('料理名を入力してください');
    expect(screen.getByTestId('error-url')).toBeInTheDocument();
    expect(screen.getByTestId('input-url')).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('http/https 以外の URL は拒否して理由を示す', async () => {
    const onSubmit = vi.fn();
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'javascript:alert(1)');
    fill('input-name', '料理');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('error-url')).toHaveTextContent('URLの形式が正しくありません');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('URL と料理名だけで保存できる（1 画面で完結）', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', ' 肉じゃが ');
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: '肉じゃが',
      url: 'https://example.com/x',
      cookTime: null,
      effort: null,
      moodTags: [],
      ingredients: [],
      memo: null,
    });
    expect(onSubmit.mock.calls[0][1]).toEqual({ confirmDuplicate: false });
  });

  it('貼り付けた URL が URL 欄に入った状態で開く', () => {
    render(<DishForm initialUrl="https://example.com/pasted" onSubmit={vi.fn()} />);
    expect(screen.getByTestId('input-url')).toHaveValue('https://example.com/pasted');
  });

  it('サーバーの入力エラー（タグの上限など）を項目の近くに出す', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new ApiError(400, 'validation', '入力エラー', { moodTags: 'タグは5個までです' }),
      );
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('error-moodTags')).toHaveTextContent('タグは5個まで');
  });

  it('同じ URL の確認：やめる／それでも保存する', async () => {
    const dup = new ApiError(
      409,
      'duplicate_url',
      'すでに保存済みです',
      {},
      { existing: { dishId: 'x', name: '先に保存した料理' } },
    );
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(dup)
      .mockRejectedValueOnce(dup)
      .mockResolvedValue(undefined);
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('duplicate-notice')).toHaveTextContent('先に保存した料理');
    fireEvent.click(screen.getByTestId('duplicate-cancel'));
    expect(screen.queryByTestId('duplicate-notice')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('submit-button'));
    fireEvent.click(await screen.findByTestId('duplicate-confirm'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2][1]).toEqual({ confirmDuplicate: true });
  });

  it('その他の失敗では、入力を残したままメッセージを出す', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network'));
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('form-error')).toBeInTheDocument();
    expect(screen.getByTestId('input-name')).toHaveValue('料理');
  });

  it('入力欄にはラベルがある', () => {
    render(<DishForm onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('URL（必須）')).toBeInTheDocument();
    expect(screen.getByLabelText('料理名（必須）')).toBeInTheDocument();
  });
});

describe('材料の行の変換', () => {
  it('「材料名 分量 単位」を配列にして、元の文字列に戻せる', () => {
    const items = parseIngredientLines('玉ねぎ 1 個\n塩\n\n豚肉、200、g');
    expect(items).toEqual([
      { name: '玉ねぎ', amount: '1', unit: '個' },
      { name: '塩', amount: null, unit: null },
      { name: '豚肉', amount: '200', unit: 'g' },
    ]);
    expect(formatIngredientLines(items)).toBe('玉ねぎ 1 個\n塩\n豚肉 200 g');
  });
});
