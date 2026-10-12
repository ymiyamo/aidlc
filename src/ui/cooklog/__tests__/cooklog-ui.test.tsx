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
import type { DishDto } from '../../types';
import { DishPicker, filterDishes } from '../DishPicker';
import { DishRecordsSection } from '../DishRecordsSection';
import { RecordsPanel } from '../RecordsPanel';
import type { MonthDto, RecordDto } from '../types';

const rec = (over: Partial<RecordDto> = {}): RecordDto => ({
  recordId: 'r1',
  dishId: 'd1',
  dishName: '肉じゃが',
  dishDeleted: false,
  cookedOn: '2026-10-03',
  impression: 'again',
  cautionMemo: '弱火で',
  memberLabel: 'はなこ',
  createdAt: '2026-10-03T01:00:00.000Z',
  ...over,
});

const month = (over: Partial<MonthDto> = {}): MonthDto => ({
  month: '2026-10',
  today: '2026-10-10',
  days: [{ date: '2026-10-03', count: 2, label: '肉じゃが ほか1件', impression: 'again' }],
  records: [
    rec(),
    rec({ recordId: 'r2', dishId: 'd2', dishName: 'カレー', impression: null, cautionMemo: null }),
  ],
  ...over,
});

const dish = (id: string, name: string, over: Partial<DishDto> = {}): DishDto => ({
  id,
  name,
  url: 'https://example.com',
  cookTime: null,
  effort: null,
  moodTags: [],
  ingredients: [],
  memo: null,
  isFavorite: false,
  source: 'user',
  updatedAt: '',
  ...over,
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
  window.sessionStorage.clear();
});
afterEach(cleanup);

const baseApi =
  (m: MonthDto = month()): Handler =>
  (method, path) => {
    if (path.startsWith('/api/records') && method === 'GET') return m;
    if (path === '/api/dishes') {
      return {
        dishes: [
          dish('d1', '肉じゃが'),
          dish('d2', 'カレー', { isFavorite: true }),
          dish('d3', 'Salad'),
        ],
      };
    }
    if (path === '/api/picked') return { picked: [{ dish: dish('d3', 'Salad') }] };
    return { ok: true };
  };

describe('記録の画面：カレンダーと一覧', () => {
  it('日に料理名・感想の印・複数の表示が出て、下に月の一覧がある', async () => {
    routeApi(baseApi());
    render(<RecordsPanel />);
    expect(await screen.findByTestId('month-title')).toHaveTextContent('2026年10月');
    expect(screen.getByTestId('cal-label-2026-10-03')).toHaveTextContent('肉じゃが ほか1件');
    expect(screen.getByTestId('cal-day-2026-10-03')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('また作りたい'),
    );
    expect(screen.getAllByTestId('record-row')).toHaveLength(2);
  });

  it('一覧に切り替えるとカレンダーは隠れ、同じ記録が出る。月を切り替えると取り直す', async () => {
    routeApi(baseApi());
    render(<RecordsPanel />);
    await screen.findByTestId('calendar');
    fireEvent.click(screen.getByTestId('view-list'));
    expect(screen.queryByTestId('calendar')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('record-row')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('month-next'));
    await waitFor(() => expect(calls('GET', '/api/records?month=2026-11')).toHaveLength(1));
  });

  it('記録のない月は「この月の記録はありません」', async () => {
    routeApi(baseApi(month({ days: [], records: [] })));
    render(<RecordsPanel />);
    expect(await screen.findByTestId('month-empty')).toHaveTextContent('この月の記録はありません');
  });

  it('日をタップすると、その日の記録と追加ボタンが出る。記録のない日でも出る', async () => {
    routeApi(baseApi());
    render(<RecordsPanel />);
    fireEvent.click(await screen.findByTestId('cal-day-2026-10-03'));
    const panel = screen.getByTestId('day-panel');
    expect(within(panel).getAllByTestId('record-row')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('cal-day-2026-10-05'));
    expect(screen.getByTestId('day-empty')).toBeInTheDocument();
    expect(screen.getByTestId('day-add-button')).toBeEnabled();
  });

  it('未来の日は追加できず、理由を示す', async () => {
    routeApi(baseApi());
    render(<RecordsPanel />);
    fireEvent.click(await screen.findByTestId('cal-day-2026-10-20'));
    expect(screen.getByTestId('day-add-button')).toBeDisabled();
    expect(screen.getByTestId('day-future-hint')).toHaveTextContent('今日まで');
  });
});

describe('記録の画面：追加・編集・削除', () => {
  it('日から項目を選んで保存すると、その日で POST して取り直す', async () => {
    routeApi(baseApi());
    render(<RecordsPanel />);
    fireEvent.click(await screen.findByTestId('cal-day-2026-10-05'));
    fireEvent.click(screen.getByTestId('day-add-button'));
    await screen.findByTestId('dish-picker');
    await waitFor(() => expect(screen.getAllByTestId('picker-item')).toHaveLength(3));
    fireEvent.click(screen.getAllByTestId('picker-item')[1]);
    expect(screen.getByTestId('record-date')).toHaveValue('2026-10-05');
    expect(screen.getByTestId('record-date')).toHaveAttribute('max', '2026-10-10');
    fireEvent.click(screen.getByTestId('record-imp-never_again'));
    fireEvent.change(screen.getByTestId('record-memo'), { target: { value: '辛い' } });
    fireEvent.click(screen.getByTestId('record-submit'));
    await waitFor(() => expect(calls('POST', '/api/records')).toHaveLength(1));
    expect(calls('POST', '/api/records')[0][2]).toEqual({
      dishId: 'd2',
      cookedOn: '2026-10-05',
      impression: 'never_again',
      cautionMemo: '辛い',
    });
    expect(await screen.findByTestId('day-panel')).toBeInTheDocument();
  });

  it('未来日付のエラーは日付の欄に出て、入力は残る', async () => {
    routeApi((m, p, b) =>
      m === 'POST'
        ? new ApiError(400, 'FUTURE_DATE_NOT_ALLOWED', '入力エラー', {
            cookedOn: '未来の日付は選べません',
          })
        : baseApi()(m, p, b),
    );
    render(<RecordsPanel />);
    fireEvent.click(await screen.findByTestId('cal-day-2026-10-05'));
    fireEvent.click(screen.getByTestId('day-add-button'));
    await waitFor(() => expect(screen.getAllByTestId('picker-item')).toHaveLength(3));
    fireEvent.click(screen.getAllByTestId('picker-item')[0]);
    fireEvent.change(screen.getByTestId('record-memo'), { target: { value: 'メモ' } });
    fireEvent.click(screen.getByTestId('record-submit'));
    expect(await screen.findByTestId('record-date-error')).toHaveTextContent(
      '未来の日付は選べません',
    );
    expect(screen.getByTestId('record-memo')).toHaveValue('メモ');
    expect(screen.getByTestId('record-date')).toHaveAttribute('aria-invalid', 'true');
  });

  it('同じ日の記録がすでにあるときは理由を示し、既存の記録の編集へ進める', async () => {
    routeApi((m, p, b) =>
      m === 'POST'
        ? new ApiError(
            409,
            'DUPLICATE_RECORD',
            'この日の記録がすでにあります',
            {},
            {
              existingRecordId: 'r1',
            },
          )
        : baseApi()(m, p, b),
    );
    render(<RecordsPanel />);
    fireEvent.click(await screen.findByTestId('cal-day-2026-10-03'));
    fireEvent.click(screen.getByTestId('day-add-button'));
    await waitFor(() => expect(screen.getAllByTestId('picker-item')).toHaveLength(3));
    fireEvent.click(screen.getAllByTestId('picker-item')[0]);
    fireEvent.click(screen.getByTestId('record-submit'));
    expect(await screen.findByTestId('record-form-error')).toHaveTextContent('すでにあります');
    fireEvent.click(screen.getByTestId('record-open-existing'));
    expect(screen.getByTestId('record-submit')).toHaveTextContent('更新する');
    expect(screen.getByTestId('record-memo')).toHaveValue('弱火で');
  });

  it('編集すると PUT する', async () => {
    routeApi(baseApi());
    render(<RecordsPanel />);
    fireEvent.click(await screen.findByTestId('cal-day-2026-10-03'));
    fireEvent.click(within(screen.getByTestId('day-panel')).getAllByTestId('record-edit')[0]);
    fireEvent.click(screen.getByTestId('record-imp-none'));
    fireEvent.click(screen.getByTestId('record-submit'));
    await waitFor(() => expect(calls('PUT', '/api/records/r1')).toHaveLength(1));
    expect(calls('PUT', '/api/records/r1')[0][2]).toMatchObject({ impression: '' });
  });

  it('削除は確認のあとだけ。「やめる」なら何も送らない', async () => {
    routeApi(baseApi());
    render(<RecordsPanel />);
    await screen.findByTestId('calendar');
    fireEvent.click(screen.getAllByTestId('record-delete')[0]);
    fireEvent.click(screen.getByTestId('record-delete-cancel'));
    expect(calls('DELETE', '/api/records/r1')).toHaveLength(0);
    fireEvent.click(screen.getAllByTestId('record-delete')[0]);
    fireEvent.click(screen.getByTestId('record-delete-confirm'));
    await waitFor(() => expect(calls('DELETE', '/api/records/r1')).toHaveLength(1));
  });

  it('削除済みの料理の記録には「（削除済み）」が付く', async () => {
    routeApi(baseApi(month({ records: [rec({ dishDeleted: true })] })));
    render(<RecordsPanel />);
    expect(await screen.findByTestId('record-dish-name')).toHaveTextContent('肉じゃが（削除済み）');
  });
});

describe('項目を選ぶ画面', () => {
  it('絞り込みの規則：大文字小文字を区別せず、前後の空白は無視。3 つの切り替えは重ねられる', () => {
    const all = [
      dish('a', 'Salad'),
      dish('b', 'カレー', { isFavorite: true }),
      dish('c', 'サラダ巻き'),
    ];
    const picked = new Set(['a', 'b']);
    expect(
      filterDishes(all, { tab: 'all', query: ' SAL ', pickedIds: picked }).map((d) => d.id),
    ).toEqual(['a']);
    expect(
      filterDishes(all, { tab: 'favorite', query: '', pickedIds: picked }).map((d) => d.id),
    ).toEqual(['b']);
    expect(
      filterDishes(all, { tab: 'recent', query: '', pickedIds: picked }).map((d) => d.id),
    ).toEqual(['a', 'b']);
    expect(
      filterDishes(all, { tab: 'recent', query: 'カ', pickedIds: picked }).map((d) => d.id),
    ).toEqual(['b']);
  });

  it('タブと文字で絞り込め、該当なしの案内と、新しく保存する入口がある', async () => {
    routeApi(baseApi());
    const onSelect = vi.fn();
    render(<DishPicker date="2026-10-05" onSelect={onSelect} onCancel={() => undefined} />);
    await waitFor(() => expect(screen.getAllByTestId('picker-item')).toHaveLength(3));
    fireEvent.click(screen.getByTestId('picker-tab-favorite'));
    expect(screen.getAllByTestId('picker-item')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('picker-tab-recent'));
    expect(screen.getByTestId('picker-item')).toHaveTextContent('Salad');
    fireEvent.change(screen.getByLabelText('料理名で絞り込む'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('picker-empty')).toHaveTextContent('該当する項目がありません');
    screen.getByTestId('picker-save-new').addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(screen.getByTestId('picker-save-new'));
    expect(window.sessionStorage.getItem('cooklog-pending-add-date')).toBe('2026-10-05');
  });

  it('保存の画面から戻ると、同じ日付で項目を選ぶ画面が開く', async () => {
    window.sessionStorage.setItem('cooklog-pending-add-date', '2026-10-05');
    routeApi(baseApi());
    render(<RecordsPanel />);
    expect(await screen.findByTestId('dish-picker')).toHaveTextContent('10月5日');
    expect(window.sessionStorage.getItem('cooklog-pending-add-date')).toBeNull();
  });
});

describe('料理の詳細：作った日', () => {
  const detail =
    (records: RecordDto[]): Handler =>
    (m, p) =>
      p === '/api/dishes/d1/records' && m === 'GET'
        ? { count: records.length, today: '2026-10-10', records }
        : { ok: true };

  it('0 件のときは案内を出す。追加の初期値は今日', async () => {
    routeApi(detail([]));
    render(<DishRecordsSection dishId="d1" dishName="肉じゃが" />);
    expect(await screen.findByTestId('dish-records-empty')).toHaveTextContent(
      'まだ作った記録がありません',
    );
    fireEvent.click(screen.getByTestId('record-add-button'));
    expect(screen.getByTestId('record-date')).toHaveValue('2026-10-10');
    fireEvent.click(screen.getByTestId('record-submit'));
    await waitFor(() => expect(calls('POST', '/api/records')).toHaveLength(1));
    expect(calls('POST', '/api/records')[0][2]).toMatchObject({
      dishId: 'd1',
      cookedOn: '2026-10-10',
    });
  });

  it('回数と一覧（感想・メモ）が出る', async () => {
    routeApi(
      detail([rec(), rec({ recordId: 'r2', cookedOn: '2026-10-01', impression: 'never_again' })]),
    );
    render(<DishRecordsSection dishId="d1" dishName="肉じゃが" />);
    expect(await screen.findByTestId('dish-records-count')).toHaveTextContent('2 回');
    expect(screen.getAllByTestId('record-row')).toHaveLength(2);
    expect(screen.getAllByTestId('record-impression')[1]).toHaveTextContent('もう作りたくない');
    expect(screen.getAllByTestId('record-memo-text')[0]).toHaveTextContent('弱火で');
    expect(screen.getByTestId('records-link')).toHaveAttribute('href', '/records');
  });
});
