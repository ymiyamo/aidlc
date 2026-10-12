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
import { DishForm } from '../../DishForm';
import { MealPlanPanel } from '../MealPlanPanel';
import {
  dayLabel,
  emptyReasonText,
  suggestsSaving,
  type MealPlanDto,
  type PlanDayDto,
  type PlanDishDto,
  type SavedPlanDto,
} from '../types';

const DATES = [
  '2026-03-02',
  '2026-03-03',
  '2026-03-04',
  '2026-03-05',
  '2026-03-06',
  '2026-03-07',
  '2026-03-08',
];

const dish = (n: number, over: Partial<PlanDishDto> = {}): PlanDishDto => ({
  dishId: `d${n}`,
  name: `料理${n}`,
  deleted: false,
  ingredientKind: 'meat',
  ...over,
});

const assigned = (i: number, over: Partial<PlanDayDto> = {}): PlanDayDto => ({
  date: DATES[i],
  dayStatus: 'assigned',
  origin: 'suggested',
  emptyReason: null,
  dish: dish(i + 1),
  ...over,
});

const plan = (days: PlanDayDto[], over: Partial<MealPlanDto> = {}): MealPlanDto => ({
  planId: 'p1',
  startDate: DATES[0],
  isSaved: false,
  name: null,
  savedAt: null,
  days,
  emptyCount: days.filter((d) => d.dayStatus === 'empty').length,
  skipCount: days.filter((d) => d.dayStatus === 'skip').length,
  sameKindStreak: false,
  ...over,
});

const full = () => plan(DATES.map((_, i) => assigned(i)));

type Handler = (method: string, path: string, body?: unknown) => unknown;
/** 画面を開いたときの 3 つの読み込みに答え、そのほかは handler に任せる */
function routeApi(
  state: { current: MealPlanDto | null; saved?: SavedPlanDto[]; assignable?: PlanDishDto[] },
  handler: Handler = () => ({}),
) {
  apiMock.mockImplementation(async (method: string, path: string, body?: unknown) => {
    if (method === 'GET' && path === '/api/meal-plans/current') return { plan: state.current };
    if (method === 'GET' && path === '/api/meal-plans') return { plans: state.saved ?? [] };
    if (method === 'GET' && path === '/api/meal-plans/assignable')
      return { dishes: state.assignable ?? [] };
    const r = handler(method, path, body);
    if (r instanceof Error) throw r;
    return r;
  });
}
const calls = (method: string, path: string) =>
  apiMock.mock.calls.filter((c) => c[0] === method && c[1] === path);

const days = () => screen.getAllByTestId('meal-day');
const dayAt = (i: number) => days()[i];

beforeEach(() => {
  apiMock.mockReset();
});
afterEach(cleanup);

describe('表示の補助', () => {
  it('日付は月日と曜日で表す（端末の時差に左右されない）', () => {
    expect(dayLabel('2026-03-02')).toBe('3/2（月）');
    expect(dayLabel('2026-12-31')).toBe('12/31（木）');
  });

  it('空欄の理由の文。足りないときだけ保存を案内する', () => {
    expect(emptyReasonText('not_enough_dishes')).toContain('料理が足りない');
    expect(emptyReasonText('not_proposed')).toContain('まだ料理を決めていません');
    expect(emptyReasonText('dish_unavailable')).toContain('削除された');
    expect(suggestsSaving('not_enough_dishes')).toBe(true);
    expect(suggestsSaving('no_valid_combination')).toBe(true);
    expect(suggestsSaving('not_proposed')).toBe(false);
    expect(suggestsSaving(null)).toBe(false);
  });
});

describe('提案を作る（US5.1）', () => {
  it('献立がなければ「提案を作る」を押して、7 日分が出る。開始日は任意', async () => {
    routeApi({ current: null }, (method, path) =>
      method === 'POST' && path === '/api/meal-plans' ? { plan: full(), notices: [] } : {},
    );
    render(<MealPlanPanel />);
    const button = await screen.findByTestId('meal-propose-button');
    expect(button).toHaveTextContent('提案を作る');
    expect(screen.queryByTestId('meal-plan')).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(days()).toHaveLength(7));
    expect(calls('POST', '/api/meal-plans')[0][2]).toEqual({});
    expect(within(dayAt(0)).getByTestId('meal-day-date')).toHaveTextContent('3/2（月）');
    expect(within(dayAt(0)).getByTestId('meal-day-dish')).toHaveTextContent('料理1');
    expect(screen.getByTestId('meal-summary')).toHaveTextContent('空き 0 日／作らない日 0 日');
    expect(screen.getByTestId('meal-plan-title')).toHaveTextContent('作業中の献立');
  });

  it('開始日を入れると、そのまま送る', async () => {
    routeApi({ current: null }, () => ({ plan: full(), notices: [] }));
    render(<MealPlanPanel />);
    fireEvent.change(await screen.findByTestId('meal-start-date'), {
      target: { value: '2026-03-09' },
    });
    fireEvent.click(screen.getByTestId('meal-propose-button'));
    await waitFor(() => expect(calls('POST', '/api/meal-plans')).toHaveLength(1));
    expect(calls('POST', '/api/meal-plans')[0][2]).toEqual({ startDate: '2026-03-09' });
  });

  it('読み込めなければ案内を出す', async () => {
    apiMock.mockRejectedValue(new ApiError(500, 'internal', 'x'));
    render(<MealPlanPanel />);
    expect(await screen.findByTestId('meal-load-error')).toBeInTheDocument();
  });

  it('作業中の献立があるとき、新しい提案は確認してから行う（BR30.15）', async () => {
    routeApi({ current: full() }, (method, path) =>
      method === 'POST' && path === '/api/meal-plans'
        ? {
            plan: plan(
              DATES.map((_, i) => assigned(i, { dish: dish(i + 11) })),
              { planId: 'p2' },
            ),
            notices: [],
          }
        : {},
    );
    render(<MealPlanPanel />);
    const button = await screen.findByTestId('meal-propose-button');
    expect(button).toHaveTextContent('新しく提案を作る');
    fireEvent.click(button);
    expect(await screen.findByTestId('meal-confirm')).toHaveTextContent('捨てられます');
    expect(calls('POST', '/api/meal-plans')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('meal-confirm-cancel'));
    expect(screen.queryByTestId('meal-confirm')).toBeNull();
    fireEvent.click(button);
    fireEvent.click(await screen.findByTestId('meal-confirm-ok'));
    await waitFor(() =>
      expect(within(dayAt(0)).getByTestId('meal-day-dish')).toHaveTextContent('料理11'),
    );
    expect(screen.queryByTestId('meal-confirm')).toBeNull();
  });
});

describe('空欄の案内（US5.3）', () => {
  const sparse = plan([
    assigned(0),
    assigned(1),
    ...[2, 3].map((i): PlanDayDto => ({
      date: DATES[i],
      dayStatus: 'empty',
      origin: null,
      emptyReason: 'not_enough_dishes',
      dish: null,
    })),
    { date: DATES[4], dayStatus: 'skip', origin: null, emptyReason: null, dish: null },
    {
      date: DATES[5],
      dayStatus: 'empty',
      origin: null,
      emptyReason: 'not_proposed',
      dish: null,
    },
    assigned(6),
  ]);

  it('空欄の日に理由を出し、足りないときは「料理を保存する」への入口を出す。空きと作らない日は別に数える', async () => {
    routeApi({ current: sparse });
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    expect(screen.getByTestId('meal-summary')).toHaveTextContent('空き 3 日／作らない日 1 日');
    expect(within(dayAt(2)).getByTestId('meal-day-reason')).toHaveTextContent('料理が足りない');
    expect(within(dayAt(2)).getByTestId('meal-save-dish-link')).toHaveAttribute(
      'href',
      '/dishes/new',
    );
    expect(within(dayAt(5)).getByTestId('meal-day-reason')).toHaveTextContent(
      'まだ料理を決めていません',
    );
    expect(within(dayAt(5)).queryByTestId('meal-save-dish-link')).toBeNull();
    expect(within(dayAt(4)).getByTestId('meal-day-skip')).toHaveTextContent('作らない日');
  });
});

describe('やり直しと作らない日（US5.2、US5.5）', () => {
  it('「この日をやり直す」はその日の API を呼び、返った献立に差し替える', async () => {
    const after = plan(DATES.map((_, i) => assigned(i, i === 2 ? { dish: dish(99) } : {})));
    routeApi({ current: full() }, (method, path) =>
      method === 'POST' && path === `/api/meal-plans/p1/days/${DATES[2]}/redo`
        ? { plan: after, notices: [] }
        : {},
    );
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    fireEvent.click(within(dayAt(2)).getByTestId('meal-redo-day'));
    await waitFor(() =>
      expect(within(dayAt(2)).getByTestId('meal-day-dish')).toHaveTextContent('料理99'),
    );
    expect(within(dayAt(1)).getByTestId('meal-day-dish')).toHaveTextContent('料理2');
  });

  it('他に使える料理がないときは案内を出す', async () => {
    routeApi({ current: full() }, () => ({
      plan: full(),
      notices: [{ code: 'NO_OTHER_DISH', message: '他に使える料理がありません' }],
    }));
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    fireEvent.click(within(dayAt(0)).getByTestId('meal-redo-day'));
    expect(await screen.findByTestId('meal-notice')).toHaveTextContent(
      '他に使える料理がありません',
    );
  });

  it('「週全体をやり直す」は週の API を呼ぶ', async () => {
    routeApi({ current: full() }, () => ({ plan: full(), notices: [] }));
    render(<MealPlanPanel />);
    fireEvent.click(await screen.findByTestId('meal-redo-week'));
    await waitFor(() => expect(calls('POST', '/api/meal-plans/p1/redo')).toHaveLength(1));
  });

  it('「この日は作らない」を押すと skip になり、「作る日に戻す」で空欄に戻る', async () => {
    const skipped = plan(
      DATES.map((_, i) =>
        i === 0
          ? ({ ...assigned(0), dayStatus: 'skip', origin: null, dish: null } as PlanDayDto)
          : assigned(i),
      ),
    );
    const cleared = plan(
      DATES.map((_, i) =>
        i === 0
          ? ({
              date: DATES[0],
              dayStatus: 'empty',
              origin: null,
              emptyReason: 'not_proposed',
              dish: null,
            } as PlanDayDto)
          : assigned(i),
      ),
    );
    routeApi({ current: full() }, (method, path, body) => {
      if (method !== 'PUT' || path !== `/api/meal-plans/p1/days/${DATES[0]}/skip`) return {};
      return { plan: (body as { skip: boolean }).skip ? skipped : cleared, notices: [] };
    });
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    fireEvent.click(within(dayAt(0)).getByTestId('meal-skip'));
    expect(await within(dayAt(0)).findByTestId('meal-day-skip')).toBeInTheDocument();
    expect(screen.getByTestId('meal-summary')).toHaveTextContent('空き 0 日／作らない日 1 日');
    expect(within(dayAt(0)).queryByTestId('meal-redo-day')).toBeNull();
    fireEvent.click(within(dayAt(0)).getByTestId('meal-unskip'));
    expect(await within(dayAt(0)).findByTestId('meal-day-reason')).toHaveTextContent(
      'まだ料理を決めていません',
    );
    expect(calls('PUT', `/api/meal-plans/p1/days/${DATES[0]}/skip`).map((c) => c[2])).toEqual([
      { skip: true },
      { skip: false },
    ]);
  });

  it('断られたとき（409）は理由を出し、献立は変えない', async () => {
    routeApi(
      { current: full() },
      () =>
        new ApiError(409, 'PLAN_SAVED', '保存した献立は変更できません。呼び出して使ってください'),
    );
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    fireEvent.click(within(dayAt(0)).getByTestId('meal-skip'));
    expect(await screen.findByTestId('meal-error')).toHaveTextContent(
      '保存した献立は変更できません',
    );
    expect(within(dayAt(0)).getByTestId('meal-day-dish')).toHaveTextContent('料理1');
  });
});

describe('選んだものの割り当て（US5.6）', () => {
  it('選んだものが 0 件なら「買い物前で選ぶ」への入口を出し、日の割り当て欄は出さない', async () => {
    routeApi({ current: full(), assignable: [] });
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    expect(screen.getByTestId('meal-assignable-empty')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('meal-assignable')).getByRole('link', { name: '買い物前で選ぶ' }),
    ).toHaveAttribute('href', '/suggest');
    expect(screen.queryAllByTestId('meal-assign-select')).toHaveLength(0);
  });

  it('候補から選んで日に入れると、手で入れた印が付く。作らない日には欄が出ない', async () => {
    const picked = dish(50, { name: '選んだ冷奴', ingredientKind: 'egg_soy' });
    const base = DATES.map((_, i) => assigned(i));
    base[1] = { date: DATES[1], dayStatus: 'skip', origin: null, emptyReason: null, dish: null };
    const after = plan(
      base.map((d, i) =>
        i === 0 ? { ...d, origin: 'assigned_by_user' as const, dish: picked } : d,
      ),
    );
    routeApi({ current: plan(base), assignable: [picked] }, (method, path, body) =>
      method === 'PUT' &&
      path === `/api/meal-plans/p1/days/${DATES[0]}/dish` &&
      (body as { dishId: string }).dishId === 'd50'
        ? { plan: after, notices: [] }
        : {},
    );
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    expect(screen.getAllByTestId('meal-assignable-item')).toHaveLength(1);
    expect(within(dayAt(1)).queryByTestId('meal-assign-select')).toBeNull();
    const assignButton = within(dayAt(0)).getByTestId('meal-assign-button');
    expect(assignButton).toBeDisabled();
    fireEvent.change(within(dayAt(0)).getByTestId('meal-assign-select'), {
      target: { value: 'd50' },
    });
    expect(assignButton).toBeEnabled();
    fireEvent.click(assignButton);
    await waitFor(() =>
      expect(within(dayAt(0)).getByTestId('meal-day-dish')).toHaveTextContent('選んだ冷奴'),
    );
    expect(within(dayAt(0)).getByTestId('meal-day-dish')).toHaveTextContent('選んで入れた');
    expect(within(dayAt(0)).getByTestId('meal-day-dish')).toHaveTextContent('卵・大豆');
  });

  it('同じ種類が 3 日続くときは注意を出す', async () => {
    routeApi({ current: full() }, () => ({
      plan: plan(
        DATES.map((_, i) => assigned(i)),
        { sameKindStreak: true },
      ),
      notices: [{ code: 'SAME_KIND_STREAK', message: '同じ種類が 3 日続きます' }],
    }));
    render(<MealPlanPanel />);
    fireEvent.click(await screen.findByTestId('meal-redo-week'));
    expect(await screen.findByTestId('meal-notice')).toHaveTextContent('同じ種類が 3 日続きます');
    expect(screen.getByTestId('meal-streak')).toBeInTheDocument();
  });
});

describe('保存と呼び出し（US5.4）', () => {
  it('名前を付けて保存すると保存済みの表示になり、日の操作の欄が消え、保存した一覧に載る', async () => {
    const saved = plan(
      DATES.map((_, i) => assigned(i)),
      { isSaved: true, name: '今週', savedAt: '2026-03-01T00:00:00Z' },
    );
    const state: { current: MealPlanDto | null; saved: SavedPlanDto[] } = {
      current: full(),
      saved: [],
    };
    routeApi(state, (method, path) => {
      if (method === 'POST' && path === '/api/meal-plans/p1/save') {
        state.saved = [
          { planId: 'p1', name: '今週', startDate: DATES[0], savedAt: '2026-03-01T00:00:00Z' },
        ];
        return { plan: saved };
      }
      return {};
    });
    render(<MealPlanPanel />);
    fireEvent.change(await screen.findByTestId('meal-name-input'), { target: { value: ' 今週 ' } });
    fireEvent.click(screen.getByTestId('meal-save-button'));
    await waitFor(() =>
      expect(screen.getByTestId('meal-plan-title')).toHaveTextContent('保存済み：今週'),
    );
    expect(calls('POST', '/api/meal-plans/p1/save')[0][2]).toEqual({ name: '今週' });
    expect(screen.queryByTestId('meal-redo-day')).toBeNull();
    expect(screen.queryByTestId('meal-redo-week')).toBeNull();
    expect(screen.queryByTestId('meal-save-button')).toBeNull();
    expect(screen.getByTestId('meal-recall-current')).toBeInTheDocument();
    expect(await screen.findAllByTestId('meal-saved-item')).toHaveLength(1);
  });

  it('保存済みの一覧から呼び出す。作業中の献立がなければ確認なしで開く', async () => {
    const copy = plan(
      DATES.map((_, i) => assigned(i)),
      { planId: 'copy' },
    );
    routeApi(
      {
        current: null,
        saved: [
          { planId: 's1', name: '先週', startDate: DATES[0], savedAt: '2026-03-01T00:00:00Z' },
        ],
      },
      (method, path) =>
        method === 'POST' && path === '/api/meal-plans/s1/recall'
          ? { plan: copy, notices: [] }
          : {},
    );
    render(<MealPlanPanel />);
    expect(await screen.findByTestId('meal-saved-item')).toHaveTextContent('先週');
    fireEvent.click(screen.getByTestId('meal-recall'));
    await waitFor(() => expect(days()).toHaveLength(7));
    expect(screen.queryByTestId('meal-confirm')).toBeNull();
    expect(screen.getByTestId('meal-plan-title')).toHaveTextContent('作業中の献立');
  });

  it('作業中の献立があるときの呼び出しは、確認してから行う', async () => {
    routeApi(
      {
        current: full(),
        saved: [
          { planId: 's1', name: '先週', startDate: DATES[0], savedAt: '2026-03-01T00:00:00Z' },
        ],
      },
      (method, path) =>
        method === 'POST' && path === '/api/meal-plans/s1/recall'
          ? {
              plan: plan(
                DATES.map((_, i) => assigned(i, { dish: dish(i + 31) })),
                { planId: 'copy' },
              ),
              notices: [],
            }
          : {},
    );
    render(<MealPlanPanel />);
    fireEvent.click(await screen.findByTestId('meal-recall'));
    expect(await screen.findByTestId('meal-confirm')).toBeInTheDocument();
    expect(calls('POST', '/api/meal-plans/s1/recall')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('meal-confirm-ok'));
    await waitFor(() =>
      expect(within(dayAt(0)).getByTestId('meal-day-dish')).toHaveTextContent('料理31'),
    );
  });

  it('削除済みの料理は「削除済み」の印つきで、リンクにしない', async () => {
    const withDeleted = plan(
      DATES.map((_, i) =>
        i === 0 ? assigned(0, { dish: dish(1, { deleted: true }) }) : assigned(i),
      ),
      {
        isSaved: true,
        name: '古い',
      },
    );
    routeApi({ current: withDeleted });
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    const cell = within(dayAt(0)).getByTestId('meal-day-dish');
    expect(cell).toHaveTextContent('削除済み');
    expect(within(cell).queryByRole('link')).toBeNull();
    expect(within(dayAt(1)).getByTestId('meal-day-dish').querySelector('a')).toHaveAttribute(
      'href',
      '/dishes/d2',
    );
  });
});

describe('買い物リストを作る（US5.5）', () => {
  const result = {
    list: {
      listId: 'l1',
      source: 'mealPlan' as const,
      planId: 'p1',
      status: 'active' as const,
      empty: false,
      stale: false,
      completedAt: null,
      completedByLabel: null,
      items: [
        {
          itemId: 'i1',
          kind: 'ingredient' as const,
          ingredientName: '玉ねぎ',
          unit: '個',
          amountLabel: '3',
          dishes: [{ dishId: 'd1', name: '料理1', deleted: false }],
          checked: false,
          checkedByLabel: null,
          checkedAt: null,
        },
        {
          itemId: 'i2',
          kind: 'needsInput' as const,
          ingredientName: null,
          unit: '',
          amountLabel: '',
          dishes: [{ dishId: 'd9', name: '冷奴', deleted: false }],
          checked: false,
          checkedByLabel: null,
          checkedAt: null,
        },
      ],
    },
    skippedDeleted: 1,
    message: '削除済みの料理は材料に含めていません',
  };

  it('押すと材料を渡して作り、結果を一覧で見せる。削除済みの案内も出す', async () => {
    routeApi({ current: full() }, (method, path) =>
      method === 'POST' && path === '/api/meal-plans/p1/shopping-list' ? result : {},
    );
    render(<MealPlanPanel />);
    fireEvent.click(await screen.findByTestId('meal-shopping-button'));
    const box = await screen.findByTestId('meal-shopping-result');
    const rows = within(box).getAllByTestId('meal-shopping-item');
    expect(rows[0]).toHaveTextContent('玉ねぎ 3個');
    expect(rows[1]).toHaveTextContent('冷奴：材料の入力が必要');
    expect(within(box).getByTestId('meal-shopping-message')).toHaveTextContent(
      '削除済みの料理は材料に含めていません',
    );
  });

  it('材料がないとき（409）は理由を出す', async () => {
    routeApi({ current: full() }, () => new ApiError(409, 'NO_INGREDIENTS', '材料がありません'));
    render(<MealPlanPanel />);
    fireEvent.click(await screen.findByTestId('meal-shopping-button'));
    expect(await screen.findByTestId('meal-error')).toHaveTextContent('材料がありません');
    expect(screen.queryByTestId('meal-shopping-result')).toBeNull();
  });
});

describe('スマホの幅（360px）', () => {
  it('操作は 1 日ごとに折り返せる並びで、名前が長くても折り返す指定がある', async () => {
    routeApi({
      current: plan(
        DATES.map((_, i) =>
          assigned(i, { dish: dish(i + 1, { name: 'とても長い料理の名前'.repeat(8) }) }),
        ),
      ),
    });
    render(<MealPlanPanel />);
    await screen.findByTestId('meal-plan');
    const dishCell = within(dayAt(0)).getByTestId('meal-day-dish');
    expect(dishCell.style.overflowWrap).toBe('anywhere');
    const row = within(dayAt(0)).getByTestId('meal-skip').parentElement!;
    expect(row.style.flexWrap).toBe('wrap');
    // 操作ボタンには、日付つきの読み上げ名が付く
    expect(within(dayAt(0)).getByTestId('meal-redo-day')).toHaveAccessibleName(
      '3/2（月）をやり直す',
    );
  });
});

describe('料理の保存・編集画面の「主な食材の種類」（BR30.19）', () => {
  const fill = (id: string, v: string) =>
    fireEvent.change(screen.getByTestId(id), { target: { value: v } });

  it('選ぶと保存の値に入る。選ばない新規の保存には含めない', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DishForm onSubmit={onSubmit} />);
    fill('input-url', 'https://example.com/x');
    fill('input-name', '焼き魚');
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect('ingredientKind' in onSubmit.mock.calls[0][0]).toBe(false);
    fill('input-ingredient-kind', 'fish');
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0].ingredientKind).toBe('fish');
  });

  it('編集では今の値が選ばれていて、未入力に戻すと null を送る', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <DishForm
        onSubmit={onSubmit}
        initial={{
          id: 'd1',
          name: '肉じゃが',
          url: 'https://example.com/x',
          cookTime: null,
          effort: null,
          ingredientKind: 'meat',
          moodTags: [],
          ingredients: [],
          memo: null,
          isFavorite: false,
          source: 'user',
          updatedAt: '2026-01-01T00:00:00Z',
        }}
      />,
    );
    expect(screen.getByTestId('input-ingredient-kind')).toHaveValue('meat');
    fill('input-ingredient-kind', '');
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].ingredientKind).toBeNull();
  });
});
