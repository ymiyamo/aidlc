// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('../../api-client', async (orig) => {
  const actual = await orig<typeof import('../../api-client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

import { ApiError } from '../../api-client';
import { DishCard } from '../../DishCard';
import { DishForm } from '../../DishForm';
import type { DishDto } from '../../types';
import { DishImageView } from '../DishImageView';
import { ImagePicker } from '../ImagePicker';
import type { DishImageDto } from '../types';

const DISH_ID = '11111111-1111-4111-8111-111111111111';

const image = (over: Partial<DishImageDto> = {}): DishImageDto => ({
  source: 'registered',
  status: 'ready',
  url: `/api/dishes/${DISH_ID}/image/file?v=1`,
  isAiGenerated: false,
  altText: '肉じゃが',
  ...over,
});

const dish = (over: Partial<DishDto> = {}): DishDto => ({
  id: DISH_ID,
  name: '肉じゃが',
  url: 'https://example.com/n',
  cookTime: null,
  effort: null,
  moodTags: [],
  ingredients: [],
  memo: null,
  isFavorite: false,
  source: 'user',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

const file = (bytes: number, type = 'image/png', name = 'a.png') =>
  new File([new Uint8Array(bytes)], name, { type });

const choose = (f: File) =>
  fireEvent.change(screen.getByTestId('input-image'), { target: { files: [f] } });

beforeEach(() => {
  apiMock.mockReset();
  // 既定：画像の状態の取得は「画像なし・失敗」を返す
  apiMock.mockImplementation(async (method: string) =>
    method === 'GET' ? { image: image({ source: 'none', status: 'failed', url: null }) } : {},
  );
});
afterEach(cleanup);

describe('画像の表示（DishImageView）', () => {
  it('登録画像は画像として出し、「AI が作ったイメージ」の印は付けない', async () => {
    render(<DishImageView dishId={DISH_ID} name="肉じゃが" load={async () => image()} />);
    const img = await screen.findByTestId('dish-image');
    expect(img).toHaveAttribute('src', image().url);
    expect(img).toHaveAttribute('alt', '肉じゃが');
    expect(screen.queryByTestId('ai-badge')).toBeNull();
  });

  it('生成画像には「AI が作ったイメージ」の印を出す', async () => {
    const gen = image({
      source: 'generated',
      isAiGenerated: true,
      altText: '肉じゃがのイメージ（AI が作ったイメージ）',
    });
    render(<DishImageView dishId={DISH_ID} name="肉じゃが" load={async () => gen} />);
    expect(await screen.findByTestId('ai-badge')).toHaveTextContent('AI が作ったイメージ');
    expect(screen.getByTestId('dish-image')).toHaveAttribute('alt', gen.altText);
  });

  it('作成中は色の枠と「作成中」を出し、できたら画像に変わる', async () => {
    const pending = image({ source: 'none', status: 'pending', url: null });
    const ready = image({ source: 'generated', isAiGenerated: true });
    // 2 回目の取得は、こちらが合図するまで終わらない（タイミングに頼らない）
    let finish: (v: DishImageDto) => void = () => {};
    const second = new Promise<DishImageDto>((r) => {
      finish = r;
    });
    const load = vi.fn().mockResolvedValueOnce(pending).mockReturnValueOnce(second);
    render(<DishImageView dishId={DISH_ID} name="肉じゃが" load={load} pollMs={10} />);
    expect(await screen.findByTestId('image-pending')).toHaveTextContent('作成中');
    expect(screen.getByTestId('dish-image-frame')).toHaveAttribute('data-state', 'pending');
    expect(screen.queryByTestId('ai-badge')).toBeNull();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    finish(ready);
    expect(await screen.findByTestId('ai-badge')).toBeInTheDocument();
  });

  it('失敗は色の枠のまま。印も「作成中」も出さず、取り直し続けない', async () => {
    const load = vi.fn().mockResolvedValue(image({ source: 'none', status: 'failed', url: null }));
    render(<DishImageView dishId={DISH_ID} name="肉じゃが" load={load} pollMs={10} />);
    const frame = await screen.findByTestId('dish-image-frame');
    await waitFor(() => expect(frame).toHaveAttribute('data-state', 'failed'));
    expect(frame).toHaveAttribute('aria-label', '肉じゃが');
    expect(screen.queryByTestId('ai-badge')).toBeNull();
    expect(screen.queryByTestId('image-pending')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('取得に失敗しても、頭文字の枠のまま表示を続ける', async () => {
    const load = vi.fn().mockRejectedValue(new Error('network'));
    render(<DishImageView dishId={DISH_ID} name="肉じゃが" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.getByTestId('dish-image-frame')).toHaveTextContent('肉');
  });

  it('候補のカードに画像の部品が入っている（印つき）', async () => {
    apiMock.mockImplementation(async () => ({
      image: image({ source: 'generated', isAiGenerated: true }),
    }));
    render(<DishCard dish={dish()} />);
    expect(await screen.findByTestId('ai-badge')).toHaveTextContent('AI が作ったイメージ');
    expect(screen.getByTestId('dish-name')).toHaveTextContent('肉じゃが');
  });
});

describe('画像を選ぶ入力（ImagePicker）', () => {
  it('ラベルがあり、画像でないファイルは理由を示して選んだことにしない', () => {
    const onFile = vi.fn();
    render(<ImagePicker name="肉じゃが" onFile={onFile} />);
    expect(screen.getByLabelText(/画像（任意/)).toBeInTheDocument();
    choose(file(10, 'text/plain', 'a.png'));
    expect(screen.getByTestId('error-image')).toHaveTextContent('画像ではありません');
    expect(onFile).toHaveBeenLastCalledWith(null);
  });

  it('5MB を超える画像は理由を示し、ちょうど 5MB は選べる', () => {
    const onFile = vi.fn();
    render(<ImagePicker name="肉じゃが" onFile={onFile} />);
    choose(file(5 * 1024 * 1024 + 1));
    expect(screen.getByTestId('error-image')).toHaveTextContent('5MB を超えています');
    expect(onFile).toHaveBeenLastCalledWith(null);
    const ok = file(5 * 1024 * 1024);
    choose(ok);
    expect(screen.queryByTestId('error-image')).toBeNull();
    expect(onFile).toHaveBeenLastCalledWith(ok);
  });

  it('編集のとき、登録画像があれば「画像を外す」が出て、押すと外す', async () => {
    let removed = false;
    apiMock.mockImplementation(async (method: string) => {
      if (method === 'DELETE') {
        removed = true;
        return { image: image({ source: 'none', status: 'pending', url: null }) };
      }
      return {
        image: removed ? image({ source: 'none', status: 'pending', url: null }) : image(),
      };
    });
    render(<ImagePicker dishId={DISH_ID} name="肉じゃが" onFile={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('remove-image'));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('DELETE', `/api/dishes/${DISH_ID}/image`),
    );
    await waitFor(() => expect(screen.queryByTestId('remove-image')).toBeNull());
  });

  it('登録画像がないとき、「画像を外す」は出さない', async () => {
    render(<ImagePicker dishId={DISH_ID} name="肉じゃが" onFile={vi.fn()} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(screen.queryByTestId('remove-image')).toBeNull();
  });
});

describe('保存・編集の画面（DishForm）の画像', () => {
  const fill = (testId: string, value: string) =>
    fireEvent.change(screen.getByTestId(testId), { target: { value } });

  it('画像を選ばなければ、これまでどおり保存できる（画像の API は呼ばない）', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(apiMock).not.toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('imageFile');
  });

  it('新規：料理を先に保存し、そのあとで画像を登録する', async () => {
    const order: string[] = [];
    const onSubmit = vi.fn().mockImplementation(async () => {
      order.push('dish');
      return { dishId: DISH_ID };
    });
    apiMock.mockImplementation(async (method: string, path: string) => {
      order.push(`${method} ${path}`);
      return { image: image() };
    });
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    choose(file(10));
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(order).toHaveLength(2));
    expect(order).toEqual(['dish', `PUT /api/dishes/${DISH_ID}/image`]);
    const call = apiMock.mock.calls.find((c) => c[0] === 'PUT')!;
    expect(call[2]).toEqual({ data: expect.any(String) });
  });

  it('新規：画像が拒否されても料理は保存済み。理由と、あとで再登録できることを示す', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ dishId: DISH_ID });
    apiMock.mockRejectedValue(
      new ApiError(415, 'IMAGE_NOT_SUPPORTED', '入力エラー', { image: '画像ではありません。' }),
    );
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    choose(file(10));
    fireEvent.click(screen.getByTestId('submit-button'));
    const err = await screen.findByTestId('error-image');
    expect(err).toHaveTextContent('料理は保存しました');
    expect(err).toHaveTextContent('画像ではありません。');
    expect(err).toHaveTextContent('編集の画面でもう一度登録できます');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('form-error')).toBeNull();
  });

  it('新規：画像まで成功してから onSaved を呼ぶ（移動は画像の登録のあと）', async () => {
    const order: string[] = [];
    const onSubmit = vi.fn().mockResolvedValue({ dishId: DISH_ID });
    const onSaved = vi.fn().mockImplementation(() => order.push('saved'));
    apiMock.mockImplementation(async (method: string) => {
      order.push(method);
      return { image: image() };
    });
    render(<DishForm onSubmit={onSubmit} onSaved={onSaved} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    choose(file(10));
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(DISH_ID));
    expect(order).toEqual(['PUT', 'saved']);
  });

  it('新規：画像を選ばなければ、保存のあとすぐ onSaved を呼ぶ', async () => {
    const onSaved = vi.fn();
    render(
      <DishForm onSubmit={vi.fn().mockResolvedValue({ dishId: DISH_ID })} onSaved={onSaved} />,
    );
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(DISH_ID));
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('新規：画像が失敗したら移動せず、二重に保存できず、編集の画面へ進める', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ dishId: DISH_ID });
    const onSaved = vi.fn();
    const onOpenEdit = vi.fn();
    apiMock.mockRejectedValue(
      new ApiError(415, 'IMAGE_NOT_SUPPORTED', '入力エラー', { image: '画像ではありません。' }),
    );
    render(<DishForm onSubmit={onSubmit} onSaved={onSaved} onOpenEdit={onOpenEdit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '料理');
    choose(file(10));
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('error-image')).toHaveTextContent('料理は保存しました');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    fireEvent.click(screen.getByTestId('open-edit-button'));
    expect(onOpenEdit).toHaveBeenCalledWith(DISH_ID);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('編集：画像を先に登録し、拒否されたら理由を示して、料理の更新はしない', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    apiMock.mockImplementation(async (method: string) => {
      if (method === 'PUT') {
        throw new ApiError(413, 'IMAGE_TOO_LARGE', '入力エラー', {
          image: '5MB を超えています。5MB 以下の画像を選んでください',
        });
      }
      return { image: image({ source: 'none', status: 'failed', url: null }) };
    });
    render(<DishForm initial={dish()} onSubmit={onSubmit} submitLabel="更新する" />);
    choose(file(10));
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('error-image')).toHaveTextContent('5MB を超えています');
    expect(onSubmit).not.toHaveBeenCalled();
    // 入力した内容は残っている
    expect(screen.getByTestId('input-name')).toHaveValue('肉じゃが');
  });

  it('編集：画像が登録できたら、料理も更新する', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    apiMock.mockImplementation(async (method: string) =>
      method === 'PUT'
        ? { image: image() }
        : { image: image({ source: 'none', status: 'failed', url: null }) },
    );
    render(<DishForm initial={dish()} onSubmit={onSubmit} submitLabel="更新する" />);
    choose(file(10));
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledWith('PUT', `/api/dishes/${DISH_ID}/image`, {
      data: expect.any(String),
    });
  });
});
