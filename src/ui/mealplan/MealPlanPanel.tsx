'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, ApiError } from '../api-client';
import { itemText, type ShoppingListDto } from '../shopping/types';
import { INGREDIENT_KIND_LABEL } from '../types';
import {
  dayLabel,
  emptyReasonText,
  suggestsSaving,
  type MealPlanDto,
  type PlanDayDto,
  type PlanDishDto,
  type PlanNoticeDto,
  type PlanResultDto,
  type SavedPlanDto,
} from './types';

// 幅 360px でも横にはみ出さないよう、長い名前は折り返す
const WRAP: CSSProperties = { overflowWrap: 'anywhere', minWidth: 0 };
const WRAP_ROW: CSSProperties = { flexWrap: 'wrap' };

type Confirm = { kind: 'propose' } | { kind: 'recall'; planId: string };

interface ShoppingResultDto {
  list: ShoppingListDto;
  skippedDeleted: number;
  message: string | null;
}

/**
 * 献立の画面の中身（US5.1〜US5.6）。
 * 提案を作る、日ごと・週全体のやり直し、作らない日、選んだものの割り当て、保存と呼び出し、買い物リストを作る。
 * 作業中の献立を捨てる操作（新しい提案、呼び出し）は、確認してから行う（BR30.15）
 */
export function MealPlanPanel() {
  const [plan, setPlan] = useState<MealPlanDto | null>(null);
  const [savedPlans, setSavedPlans] = useState<SavedPlanDto[]>([]);
  const [assignable, setAssignable] = useState<PlanDishDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notices, setNotices] = useState<PlanNoticeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [shopping, setShopping] = useState<ShoppingResultDto | null>(null);

  const load = useCallback(async () => {
    try {
      const [current, saved, picked] = await Promise.all([
        api<{ plan: MealPlanDto | null }>('GET', '/api/meal-plans/current'),
        api<{ plans: SavedPlanDto[] }>('GET', '/api/meal-plans'),
        api<{ dishes: PlanDishDto[] }>('GET', '/api/meal-plans/assignable'),
      ]);
      setPlan(current.plan);
      setSavedPlans(saved.plans);
      setAssignable(picked.dishes);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 操作を 1 つずつ行う。失敗したら理由を示して、画面の献立は変えない */
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : '操作できませんでした。もう一度お試しください',
      );
    } finally {
      setBusy(false);
    }
  };

  const applyResult = (res: PlanResultDto) => {
    setPlan(res.plan);
    setNotices(res.notices);
  };

  const refreshSaved = async () => {
    const saved = await api<{ plans: SavedPlanDto[] }>('GET', '/api/meal-plans');
    setSavedPlans(saved.plans);
  };

  const propose = () =>
    act(async () => {
      const res = await api<PlanResultDto>('POST', '/api/meal-plans', {
        ...(startDate ? { startDate } : {}),
      });
      applyResult(res);
      setShopping(null);
      setConfirm(null);
    });

  const recall = (planId: string) =>
    act(async () => {
      applyResult(await api<PlanResultDto>('POST', `/api/meal-plans/${planId}/recall`));
      setShopping(null);
      setConfirm(null);
    });

  const redoDay = (date: string) =>
    act(async () => {
      applyResult(
        await api<PlanResultDto>('POST', `/api/meal-plans/${plan!.planId}/days/${date}/redo`),
      );
    });

  const redoWeek = () =>
    act(async () => {
      applyResult(await api<PlanResultDto>('POST', `/api/meal-plans/${plan!.planId}/redo`));
    });

  const setSkip = (date: string, skip: boolean) =>
    act(async () => {
      applyResult(
        await api<PlanResultDto>('PUT', `/api/meal-plans/${plan!.planId}/days/${date}/skip`, {
          skip,
        }),
      );
    });

  const assign = (date: string) =>
    act(async () => {
      const dishId = choice[date];
      if (!dishId) return;
      applyResult(
        await api<PlanResultDto>('PUT', `/api/meal-plans/${plan!.planId}/days/${date}/dish`, {
          dishId,
        }),
      );
    });

  const save = () =>
    act(async () => {
      const res = await api<{ plan: MealPlanDto }>('POST', `/api/meal-plans/${plan!.planId}/save`, {
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setPlan(res.plan);
      setNotices([]);
      setName('');
      await refreshSaved();
    });

  const makeShoppingList = () =>
    act(async () => {
      setShopping(
        await api<ShoppingResultDto>('POST', `/api/meal-plans/${plan!.planId}/shopping-list`),
      );
    });

  if (loadError && !loaded) {
    return (
      <p className="error" role="alert" data-testid="meal-load-error">
        献立を読み込めませんでした。
      </p>
    );
  }
  if (!loaded) return <p role="status">読み込み中…</p>;
  if (loadError) {
    return (
      <p className="error" role="alert" data-testid="meal-load-error">
        献立を読み込めませんでした。
      </p>
    );
  }

  const working = plan && !plan.isSaved;
  const askBeforeDiscard = (next: Confirm, run: () => void) => (working ? setConfirm(next) : run());

  return (
    <>
      {error && (
        <p className="error" role="alert" data-testid="meal-error">
          {error}
        </p>
      )}
      {notices.map((n) => (
        <p key={n.code} className="card notice" role="status" data-testid="meal-notice">
          {n.message}
        </p>
      ))}

      <section className="card" aria-label="献立を作る">
        <h2>1 週間の献立を提案する</h2>
        <div className="form">
          <label htmlFor="meal-start-date">はじめの日（空なら今日から）</label>
          <input
            id="meal-start-date"
            data-testid="meal-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn primary block"
          data-testid="meal-propose-button"
          disabled={busy}
          onClick={() => askBeforeDiscard({ kind: 'propose' }, () => void propose())}
        >
          {working ? '新しく提案を作る' : '提案を作る'}
        </button>
        <p className="hint">
          同じ料理は 1 週間に 1 回まで。同じ種類の食材が 3 日続かないようにします。
        </p>
      </section>

      {confirm && (
        <div
          className="card"
          role="alertdialog"
          aria-label="作業中の献立を捨てる確認"
          data-testid="meal-confirm"
        >
          <p>いま作業中の献立は捨てられます（保存した献立は残ります）。よろしいですか？</p>
          <div className="row">
            <button
              type="button"
              className="btn grow"
              data-testid="meal-confirm-cancel"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn primary grow"
              data-testid="meal-confirm-ok"
              disabled={busy}
              onClick={() => void (confirm.kind === 'propose' ? propose() : recall(confirm.planId))}
            >
              捨てて進む
            </button>
          </div>
        </div>
      )}

      {plan && (
        <section
          aria-label="献立"
          data-testid="meal-plan"
          data-saved={plan.isSaved ? 'true' : 'false'}
        >
          <h2 data-testid="meal-plan-title" style={WRAP}>
            {plan.isSaved ? `保存済み：${plan.name ?? ''}` : '作業中の献立'}
          </h2>
          <p className="hint" data-testid="meal-summary">
            空き {plan.emptyCount} 日／作らない日 {plan.skipCount} 日
          </p>
          {plan.sameKindStreak && (
            <p className="card notice" role="status" data-testid="meal-streak">
              同じ種類の食材が 3 日続いている所があります。
            </p>
          )}
          <ul className="list" data-testid="meal-days">
            {plan.days.map((day) => (
              <DayRow
                key={day.date}
                day={day}
                saved={plan.isSaved}
                busy={busy}
                assignable={assignable}
                choice={choice[day.date] ?? ''}
                onChoice={(dishId) => setChoice((c) => ({ ...c, [day.date]: dishId }))}
                onRedo={() => void redoDay(day.date)}
                onSkip={(skip) => void setSkip(day.date, skip)}
                onAssign={() => void assign(day.date)}
              />
            ))}
          </ul>

          {plan.isSaved ? (
            <>
              <p className="hint">保存した献立は変更できません。呼び出して使ってください。</p>
              <button
                type="button"
                className="btn block"
                data-testid="meal-recall-current"
                disabled={busy}
                onClick={() =>
                  askBeforeDiscard(
                    { kind: 'recall', planId: plan.planId },
                    () => void recall(plan.planId),
                  )
                }
              >
                呼び出して使う
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn block"
                data-testid="meal-redo-week"
                disabled={busy}
                onClick={() => void redoWeek()}
              >
                週全体をやり直す
              </button>
              <div className="form card">
                <label htmlFor="meal-name">
                  保存の名前（空なら「{dayLabelShort(plan.startDate)}からの献立」）
                </label>
                <input
                  id="meal-name"
                  data-testid="meal-name-input"
                  type="text"
                  maxLength={50}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn primary block"
                  data-testid="meal-save-button"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  保存する
                </button>
              </div>
            </>
          )}

          <button
            type="button"
            className="btn primary block"
            data-testid="meal-shopping-button"
            disabled={busy}
            onClick={() => void makeShoppingList()}
          >
            この献立の買い物リストを作る
          </button>
        </section>
      )}

      {shopping && (
        <section
          className="card"
          aria-label="この献立の買い物リスト"
          data-testid="meal-shopping-result"
        >
          <h2>この献立の買い物リスト</h2>
          {shopping.message && (
            <p className="hint" data-testid="meal-shopping-message">
              {shopping.message}
            </p>
          )}
          {shopping.list.items.length === 0 ? (
            <p>買い物リストは空です。</p>
          ) : (
            <ul className="list">
              {shopping.list.items.map((i) => (
                <li key={i.itemId} data-testid="meal-shopping-item" style={WRAP}>
                  {i.kind === 'needsInput' ? (
                    <>
                      <strong>{i.dishes[0]?.name}</strong>：材料の入力が必要
                    </>
                  ) : (
                    <>
                      <strong>{itemText(i)}</strong>
                      <span className="hint" style={{ display: 'block' }}>
                        {i.dishes.map((d) => d.name).join('、')}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card" aria-label="選んだもの" data-testid="meal-assignable">
        <h2>日に入れられる「選んだもの」</h2>
        {assignable.length === 0 ? (
          <div data-testid="meal-assignable-empty">
            <p>選んだものはまだありません。</p>
            <Link className="btn small" href="/suggest">
              買い物前で選ぶ
            </Link>
          </div>
        ) : (
          <ul className="list">
            {assignable.map((d) => (
              <li key={d.dishId} data-testid="meal-assignable-item" style={WRAP}>
                {d.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-label="保存した献立" data-testid="meal-saved-list">
        <h2>保存した献立</h2>
        {savedPlans.length === 0 ? (
          <p className="hint">保存した献立はまだありません。</p>
        ) : (
          <ul className="list">
            {savedPlans.map((p) => (
              <li key={p.planId} data-testid="meal-saved-item">
                <div className="row" style={WRAP_ROW}>
                  <span className="grow" style={WRAP}>
                    <strong>{p.name}</strong>
                    <span className="hint" style={{ display: 'block' }}>
                      {dayLabel(p.startDate)}から
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    data-testid="meal-recall"
                    disabled={busy}
                    onClick={() =>
                      askBeforeDiscard(
                        { kind: 'recall', planId: p.planId },
                        () => void recall(p.planId),
                      )
                    }
                  >
                    呼び出す
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** 「M/D」だけ（既定の名前の案内に使う） */
const dayLabelShort = (date: string) => dayLabel(date).split('（')[0];

function DayRow({
  day,
  saved,
  busy,
  assignable,
  choice,
  onChoice,
  onRedo,
  onSkip,
  onAssign,
}: {
  day: PlanDayDto;
  saved: boolean;
  busy: boolean;
  assignable: PlanDishDto[];
  choice: string;
  onChoice: (dishId: string) => void;
  onRedo: () => void;
  onSkip: (skip: boolean) => void;
  onAssign: () => void;
}) {
  const label = dayLabel(day.date);
  return (
    <li className="card" data-testid="meal-day" data-date={day.date} data-status={day.dayStatus}>
      <p style={WRAP}>
        <strong data-testid="meal-day-date">{label}</strong>
      </p>

      {day.dayStatus === 'assigned' && day.dish && (
        <p style={WRAP} data-testid="meal-day-dish">
          {day.dish.deleted ? (
            <>
              {day.dish.name}
              <span className="badge">削除済み</span>
            </>
          ) : (
            <Link href={`/dishes/${day.dish.dishId}`}>{day.dish.name}</Link>
          )}
          {day.dish.ingredientKind && (
            <span className="badge">{INGREDIENT_KIND_LABEL[day.dish.ingredientKind]}</span>
          )}
          {day.origin === 'assigned_by_user' && <span className="badge">選んで入れた</span>}
        </p>
      )}

      {day.dayStatus === 'skip' && (
        <p className="hint" data-testid="meal-day-skip">
          作らない日
        </p>
      )}

      {day.dayStatus === 'empty' && (
        <div data-testid="meal-day-empty">
          <p className="hint" data-testid="meal-day-reason" style={WRAP}>
            {emptyReasonText(day.emptyReason)}
          </p>
          {suggestsSaving(day.emptyReason) && (
            <Link className="btn small" href="/dishes/new" data-testid="meal-save-dish-link">
              料理を保存する
            </Link>
          )}
        </div>
      )}

      {!saved && (
        <>
          <div className="row" style={WRAP_ROW}>
            {day.dayStatus === 'skip' ? (
              <button
                type="button"
                className="btn small"
                data-testid="meal-unskip"
                aria-label={`${label}を作る日に戻す`}
                disabled={busy}
                onClick={() => onSkip(false)}
              >
                作る日に戻す
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn small"
                  data-testid="meal-redo-day"
                  aria-label={`${label}をやり直す`}
                  disabled={busy}
                  onClick={onRedo}
                >
                  この日をやり直す
                </button>
                <button
                  type="button"
                  className="btn small"
                  data-testid="meal-skip"
                  aria-label={`${label}は作らない`}
                  disabled={busy}
                  onClick={() => onSkip(true)}
                >
                  この日は作らない
                </button>
              </>
            )}
          </div>
          {day.dayStatus !== 'skip' && assignable.length > 0 && (
            <div className="row" style={WRAP_ROW}>
              <select
                className="grow"
                aria-label={`${label}に入れる、選んだもの`}
                data-testid="meal-assign-select"
                value={choice}
                onChange={(e) => onChoice(e.target.value)}
              >
                <option value="">選んだものから入れる</option>
                {assignable.map((d) => (
                  <option key={d.dishId} value={d.dishId}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn small"
                data-testid="meal-assign-button"
                disabled={busy || !choice}
                onClick={onAssign}
              >
                入れる
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}
