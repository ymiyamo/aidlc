import { describe, expect, it } from 'vitest';
import type { IngredientKind } from '@/repo/dishes';
import {
  MAX_SAME_DISH,
  assignmentMakesStreak,
  countElsewhere,
  hasKindStreak,
  kindStreakAt,
  pickReplacement,
  proposeWeek,
  shuffle,
  type DayState,
  type PlanCandidate,
  type Slot,
} from '../planner';
import { seeded } from './seeded';

const dish = (n: number, kind: IngredientKind | null): PlanCandidate => ({
  dishId: `d${n}`,
  kind,
});
const FREE: Slot[] = Array(7).fill('free');

const kindsOf = (days: ReturnType<typeof proposeWeek>, all: PlanCandidate[]) =>
  days.map((d) =>
    d.status === 'assigned' ? (all.find((c) => c.dishId === d.dishId)?.kind ?? null) : null,
  );

describe('並べ替えと種類の判定', () => {
  it('shuffle は同じ乱数列なら同じ並びで、要素は変わらず、元の配列を壊さない', () => {
    const src = [1, 2, 3, 4, 5, 6];
    const a = shuffle(src, seeded(7));
    expect(a).toEqual(shuffle(src, seeded(7)));
    expect([...a].sort()).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('同じ種類が 3 日続く並びだけを見つける。null は途切れる（BR30.4）', () => {
    expect(hasKindStreak(['meat', 'meat', 'meat', null, null, null, null])).toBe(true);
    expect(hasKindStreak(['meat', 'meat', null, 'meat', 'meat', null, null])).toBe(false);
    expect(hasKindStreak(['meat', 'meat', 'fish', 'meat', 'meat', 'fish', 'meat'])).toBe(false);
    expect(hasKindStreak([null, null, null, null, null, null, null])).toBe(false);
    expect(kindStreakAt(['fish', 'meat', 'meat', 'meat', 'fish', null, null], 3)).toBe(true);
    expect(kindStreakAt(['fish', 'meat', 'meat', 'meat', 'fish', null, null], 0)).toBe(false);
  });
});

describe('提案の探索（BR30.5、検証できる性質 P1〜P4）', () => {
  it('P1〜P3：乱数を変えても、7 件以上あれば空欄 0、同じ料理は 1 回まで、同じ種類が 3 日続かない', () => {
    const all = [
      ...[1, 2, 3, 4].map((n) => dish(n, 'meat')),
      ...[5, 6, 7].map((n) => dish(n, 'fish')),
      ...[8, 9].map((n) => dish(n, 'vegetable')),
    ];
    for (let seed = 1; seed <= 60; seed++) {
      const days = proposeWeek({ slots: FREE, front: all, random: seeded(seed) });
      const ids = days.map((d) => (d.status === 'assigned' ? d.dishId : null));
      expect(
        ids.every((x) => x !== null),
        `seed ${seed}`,
      ).toBe(true);
      expect(new Set(ids).size).toBe(7);
      expect(hasKindStreak(kindsOf(days, all)), `seed ${seed}`).toBe(false);
    }
  });

  it('V5：同じ種類だけ 4 件と、他の種類 4 件でも、同じ種類が 3 日続く並びは作られない', () => {
    const all = [
      ...[1, 2, 3, 4].map((n) => dish(n, 'meat')),
      ...[5, 6, 7, 8].map((n) => dish(n, 'fish')),
    ];
    for (let seed = 1; seed <= 40; seed++) {
      const days = proposeWeek({ slots: FREE, front: all, random: seeded(seed) });
      expect(days.every((d) => d.status === 'assigned')).toBe(true);
      expect(hasKindStreak(kindsOf(days, all))).toBe(false);
    }
  });

  it('P3：先に選んだ料理が行き詰まる並びでも、戻ってやり直して全部埋める', () => {
    // 肉 5 件と魚 2 件では、肉・肉・魚・肉・肉・魚・肉 のようにしか 7 日を埋められない
    const all = [...[1, 2, 3, 4, 5].map((n) => dish(n, 'meat')), dish(6, 'fish'), dish(7, 'fish')];
    for (let seed = 1; seed <= 40; seed++) {
      const days = proposeWeek({ slots: FREE, front: all, random: seeded(seed) });
      expect(
        days.every((d) => d.status === 'assigned'),
        `seed ${seed}`,
      ).toBe(true);
      expect(hasKindStreak(kindsOf(days, all))).toBe(false);
    }
  });

  it('V3：5 件しかなければ 5 日が埋まり、残り 2 日は「足りない」空欄', () => {
    const all = [1, 2, 3, 4, 5].map((n) => dish(n, null));
    const days = proposeWeek({ slots: FREE, front: all, random: seeded(3) });
    expect(days.filter((d) => d.status === 'assigned')).toHaveLength(5);
    const empties = days.filter((d) => d.status === 'empty');
    expect(empties).toHaveLength(2);
    expect(empties.every((d) => d.status === 'empty' && d.reason === 'not_enough_dishes')).toBe(
      true,
    );
    const ids = days.flatMap((d) => (d.status === 'assigned' ? [d.dishId] : []));
    expect(new Set(ids).size).toBe(5);
  });

  it('料理が 0 件なら 7 日すべてが「足りない」空欄', () => {
    const days = proposeWeek({ slots: FREE, front: [], random: seeded(1) });
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.status === 'empty' && d.reason === 'not_enough_dishes')).toBe(true);
  });

  it('V4：作らない日は skip のまま、空きの数に数えない（その日を除いた数だけ埋まる）', () => {
    const slots: Slot[] = ['free', 'skip', 'free', 'free', 'skip', 'free', 'free'];
    const all = [1, 2, 3, 4, 5].map((n) => dish(n, null));
    const days = proposeWeek({ slots, front: all, random: seeded(9) });
    expect(days.map((d) => d.status)).toEqual([
      'assigned',
      'skip',
      'assigned',
      'assigned',
      'skip',
      'assigned',
      'assigned',
    ]);
  });

  it('作らない日は種類の続きを途切れさせる', () => {
    const slots: Slot[] = ['free', 'free', 'skip', 'free', 'free', 'skip', 'free'];
    const all = [...[1, 2, 3, 4, 5].map((n) => dish(n, 'meat'))];
    const days = proposeWeek({ slots, front: all, random: seeded(2) });
    expect(days.filter((d) => d.status === 'assigned')).toHaveLength(5);
  });

  it('「後ろにずらす料理」は、先の料理が足りないときだけ使う', () => {
    const front = [1, 2, 3, 4, 5, 6, 7].map((n) => dish(n, null));
    const back = [dish(100, null)];
    for (let seed = 1; seed <= 20; seed++) {
      const days = proposeWeek({ slots: FREE, front, back, random: seeded(seed) });
      expect(days.some((d) => d.status === 'assigned' && d.dishId === 'd100')).toBe(false);
    }
    const few = proposeWeek({
      slots: FREE,
      front: [1, 2, 3, 4, 5, 6].map((n) => dish(n, null)),
      back,
      random: seeded(1),
    });
    expect(few.every((d) => d.status === 'assigned')).toBe(true);
  });

  it('組み合わせが作れない（同じ種類 7 件）ときは「組み合わせがない」空欄を返し、探索は上限で止まる', () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map((n) => dish(n, 'meat'));
    const days = proposeWeek({ slots: FREE, front: all, random: seeded(4) });
    expect(days.filter((d) => d.status === 'assigned').length).toBeLessThan(7);
    expect(hasKindStreak(kindsOf(days, all))).toBe(false);
    const empties = days.filter((d) => d.status === 'empty');
    expect(empties.every((d) => d.status === 'empty' && d.reason === 'no_valid_combination')).toBe(
      true,
    );
    // 上限を小さくしても、必ず 7 日分を返す
    const capped = proposeWeek({ slots: FREE, front: all, random: seeded(4), maxSteps: 3 });
    expect(capped).toHaveLength(7);
  });

  it('同じ乱数列なら同じ結果になる（P4）', () => {
    const all = Array.from({ length: 20 }, (_, i) =>
      dish(i, (['meat', 'fish', 'vegetable'] as const)[i % 3]),
    );
    const a = proposeWeek({ slots: FREE, front: all, random: seeded(11) });
    expect(proposeWeek({ slots: FREE, front: all, random: seeded(11) })).toEqual(a);
    expect(proposeWeek({ slots: FREE, front: all, random: seeded(12) })).not.toEqual(a);
  });

  it('V9：200 件でも十分に速い（3 秒に対して 1 秒未満）', () => {
    const kinds: (IngredientKind | null)[] = [
      'meat',
      'fish',
      'vegetable',
      'egg_soy',
      'other',
      null,
    ];
    const all = Array.from({ length: 200 }, (_, i) => dish(i, kinds[i % kinds.length]));
    const started = performance.now();
    for (let seed = 1; seed <= 20; seed++)
      proposeWeek({ slots: FREE, front: all, random: seeded(seed) });
    expect((performance.now() - started) / 20).toBeLessThan(1000);
  });
});

describe('日のやり直しと手割り当ての判定', () => {
  const state = (dishId: string | null, kind: IngredientKind | null): DayState =>
    dishId ? { status: 'assigned', dishId, kind } : { status: 'empty', dishId: null, kind: null };

  it('現在の料理と違う料理を返し、他の日の状態は渡した配列を変えない', () => {
    const days = [state('a', 'meat'), state('b', 'fish'), state('c', 'vegetable')];
    const copy = JSON.stringify(days);
    const picked = pickReplacement({
      days,
      index: 1,
      candidates: [
        { dishId: 'b', kind: 'fish' },
        { dishId: 'x', kind: null },
      ],
      random: seeded(1),
    });
    expect(picked?.dishId).toBe('x');
    expect(JSON.stringify(days)).toBe(copy);
  });

  it('他の日にまだ入っていない料理を先に選び、なければ 1 回使った料理を選ぶ', () => {
    const days = [state('a', null), state('b', null), state('c', null)];
    const cands = [
      { dishId: 'a', kind: null },
      { dishId: 'c', kind: null },
      { dishId: 'z', kind: null },
    ];
    for (let seed = 1; seed <= 10; seed++) {
      expect(
        pickReplacement({ days, index: 1, candidates: cands, random: seeded(seed) })?.dishId,
      ).toBe('z');
    }
    const again = pickReplacement({
      days,
      index: 1,
      candidates: cands.slice(0, 2),
      random: seeded(1),
    });
    expect(['a', 'c']).toContain(again?.dishId);
  });

  it('すでに他の 2 日に入っている料理は選ばない。使える料理がなければ null（BR30.3）', () => {
    const days = [state('a', null), state('a', null), state('b', null)];
    expect(countElsewhere(days, 2, 'a')).toBe(MAX_SAME_DISH);
    expect(
      pickReplacement({
        days,
        index: 2,
        candidates: [
          { dishId: 'a', kind: null },
          { dishId: 'b', kind: null },
        ],
        random: seeded(1),
      }),
    ).toBeNull();
  });

  it('同じ種類が 3 日続く料理は選ばない（BR30.4）', () => {
    const days = [state('a', 'meat'), state('b', 'meat'), state('c', 'fish')];
    const picked = pickReplacement({
      days,
      index: 2,
      candidates: [
        { dishId: 'm', kind: 'meat' },
        { dishId: 'v', kind: 'vegetable' },
      ],
      random: seeded(1),
    });
    expect(picked?.dishId).toBe('v');
  });

  it('手割り当てが種類の 3 日続きを作るかを判定する', () => {
    const days = [state('a', 'meat'), state('b', 'meat'), state(null, null)];
    expect(assignmentMakesStreak(days, 2, 'meat')).toBe(true);
    expect(assignmentMakesStreak(days, 2, 'fish')).toBe(false);
    expect(assignmentMakesStreak(days, 2, null)).toBe(false);
  });
});
