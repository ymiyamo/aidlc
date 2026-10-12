import { describe, expect, it } from 'vitest';
import {
  displayAmount,
  fromDecimalString,
  normalizeDecimalString,
  parseAmount,
  toDecimalString,
} from '../amount';
import { aggregateIngredients, type ComposeDish } from '../compose';

const ids = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID() };
const dish = (
  dishId: string,
  ingredients: [string, string | null, string | null][],
): ComposeDish => ({
  dishId,
  name: dishId,
  ingredients: ingredients.map(([name, amount, unit]) => ({ name, amount, unit })),
});

describe('分量の読み取り（BR20.5、BR20.7）', () => {
  it('整数・小数・分数・全角は数として読む', () => {
    expect(parseAmount('2')).toEqual({ kind: 'numeric', micro: 2_000_000n });
    expect(parseAmount(' 1.5 ')).toEqual({ kind: 'numeric', micro: 1_500_000n });
    expect(parseAmount('1/2')).toEqual({ kind: 'numeric', micro: 500_000n });
    expect(parseAmount('１．５')).toEqual({ kind: 'numeric', micro: 1_500_000n });
    expect(parseAmount('１／４')).toEqual({ kind: 'numeric', micro: 250_000n });
  });

  it('数でない書き方・0・分母が 0 は、元の書き方のままの text。空は none', () => {
    expect(parseAmount('少々')).toEqual({ kind: 'text', text: '少々' });
    expect(parseAmount(' 2〜3 ')).toEqual({ kind: 'text', text: '2〜3' });
    expect(parseAmount('1と1/2')).toEqual({ kind: 'text', text: '1と1/2' });
    expect(parseAmount('1 1/2')).toEqual({ kind: 'text', text: '1 1/2' });
    expect(parseAmount('0')).toEqual({ kind: 'text', text: '0' });
    expect(parseAmount('0.0')).toEqual({ kind: 'text', text: '0.0' });
    expect(parseAmount('0/3')).toEqual({ kind: 'text', text: '0/3' });
    expect(parseAmount('1/0')).toEqual({ kind: 'text', text: '1/0' });
    expect(parseAmount('-1')).toEqual({ kind: 'text', text: '-1' });
    expect(parseAmount(null)).toEqual({ kind: 'none' });
    expect(parseAmount('   ')).toEqual({ kind: 'none' });
  });

  it('小数第 7 位以下は四捨五入して小数第 6 位までにする', () => {
    expect(parseAmount('0.1234565')).toEqual({ kind: 'numeric', micro: 123_457n });
    // 丸めると 0 になるものは数として扱わない
    expect(parseAmount('0.0000001').kind).toBe('text');
  });
});

describe('10 進の保存形と表示（BR20.5）', () => {
  it('0.1 + 0.2 は正確に 0.3', () => {
    const sum =
      (parseAmount('0.1') as { micro: bigint }).micro +
      (parseAmount('0.2') as { micro: bigint }).micro;
    expect(toDecimalString(sum)).toBe('0.3');
  });

  it('保存形は末尾の 0 を付けず、読み戻して同じ。別の書き方も同じ文字列にそろう', () => {
    expect(toDecimalString(3_000_000n)).toBe('3');
    expect(toDecimalString(333_333n)).toBe('0.333333');
    expect(fromDecimalString('0.333333')).toBe(333_333n);
    expect(normalizeDecimalString('1.50')).toBe('1.5');
    expect(normalizeDecimalString(null)).toBeNull();
  });

  it('表示：整数は整数、割り切れない小数は小数第 2 位まで四捨五入', () => {
    expect(displayAmount(3_000_000n)).toBe('3');
    expect(displayAmount(1_500_000n)).toBe('1.5');
    expect(displayAmount(333_333n)).toBe('0.33');
    expect(displayAmount(3_456_000n)).toBe('3.46');
    expect(displayAmount(999_999n)).toBe('1');
    expect(displayAmount(1_005_000n)).toBe('1.01');
    expect(displayAmount(4_000n)).toBe('0.004');
  });
});

describe('集計の規則（BR20.4〜BR20.8。設計の「集計の例」の表）', () => {
  it('玉ねぎ 2 個と 1 個は「玉ねぎ 3 個」の 1 行（2 つの料理の名前つき）', () => {
    const rows = aggregateIngredients([
      dish(ids.a, [['玉ねぎ', '2', '個']]),
      dish(ids.b, [['玉ねぎ', '1', '個']]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'ingredient',
      ingredientName: '玉ねぎ',
      unit: '個',
      amountKind: 'numeric',
      amountNumber: '3',
      amountText: '3',
      sourceDishIds: [ids.a, ids.b],
    });
  });

  it('玉ねぎ 2 個と 200 g は別の行（換算しない）。単位なしと「個」も別', () => {
    const rows = aggregateIngredients([
      dish(ids.a, [['玉ねぎ', '2', '個']]),
      dish(ids.b, [
        ['玉ねぎ', '200', 'g'],
        ['玉ねぎ', '1', null],
      ]),
    ]);
    expect(rows.map((r) => [r.ingredientName, r.unit, r.amountNumber]).sort()).toEqual([
      ['玉ねぎ', '', '1'],
      ['玉ねぎ', 'g', '200'],
      ['玉ねぎ', '個', '2'],
    ]);
  });

  it('「塩 少々」は料理ごとに別の行。同じ料理の同じ書き方は 1 行', () => {
    const rows = aggregateIngredients([
      dish(ids.a, [
        ['塩', '少々', null],
        ['塩', '少々', null],
      ]),
      dish(ids.b, [['塩', '少々', null]]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sourceDishIds)).toEqual([[ids.a], [ids.b]]);
    expect(rows.every((r) => r.amountKind === 'text' && r.amountText === '少々')).toBe(true);
    expect(new Set(rows.map((r) => r.lineKey)).size).toBe(2);
  });

  it('分量が空の「醤油」も料理ごとの行。書き方が違う「適量」とも別', () => {
    const rows = aggregateIngredients([
      dish(ids.a, [
        ['醤油', null, null],
        ['醤油', '適量', null],
      ]),
      dish(ids.b, [['醤油', '', null]]),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.amountKind === 'none')).toHaveLength(2);
    expect(rows.find((r) => r.amountKind === 'text')?.amountText).toBe('適量');
  });

  it('数の行と、数でない行は、同じ材料名・単位でも足さない', () => {
    const rows = aggregateIngredients([
      dish(ids.a, [
        ['砂糖', '大さじ1', null],
        ['砂糖', '2', null],
        ['砂糖', '0', null],
      ]),
      dish(ids.b, [['砂糖', '3', null]]),
    ]);
    expect(rows.filter((r) => r.amountKind === 'numeric')).toHaveLength(1);
    expect(rows.find((r) => r.amountKind === 'numeric')?.amountNumber).toBe('5');
    expect(
      rows
        .filter((r) => r.amountKind === 'text')
        .map((r) => r.amountText)
        .sort(),
    ).toEqual(['0', '大さじ1']);
  });

  it('材料が 0 行の料理は、料理ごとに「材料の入力が必要」の行', () => {
    const rows = aggregateIngredients([dish(ids.c, []), dish(ids.a, [['塩', '1', 'g']])]);
    const needs = rows.find((r) => r.kind === 'needsInput')!;
    expect(needs).toMatchObject({ ingredientName: null, amountKind: null, sourceDishIds: [ids.c] });
    expect(rows).toHaveLength(2);
  });

  it('食材名は前後の空白だけ除く。読み替えはしない（玉ねぎとたまねぎは別）', () => {
    const rows = aggregateIngredients([
      dish(ids.a, [[' 玉ねぎ ', '1', ' 個 ']]),
      dish(ids.b, [
        ['玉ねぎ', '1', '個'],
        ['たまねぎ', '1', '個'],
      ]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.ingredientName === '玉ねぎ')?.amountNumber).toBe('2');
  });

  it('小数の合算は正確（0.1 + 0.2 = 0.3、1/2 + 1/2 = 1、1/3 を 3 つで 1 と表示）', () => {
    const f = (amounts: string[]) =>
      aggregateIngredients([
        dish(
          ids.a,
          amounts.map((a) => ['小麦粉', a, 'カップ']),
        ),
      ])[0];
    expect(f(['0.1', '0.2']).amountNumber).toBe('0.3');
    expect(f(['1/2', '1/2'])).toMatchObject({ amountNumber: '1', amountText: '1' });
    expect(f(['1/3', '1/3', '1/3'])).toMatchObject({ amountNumber: '0.999999', amountText: '1' });
    expect(f(['1.25', '1'])).toMatchObject({ amountNumber: '2.25', amountText: '2.25' });
  });

  it('同じ料理を 2 回渡すと（献立）、数の行は 2 回分を足し、料理は重複しない', () => {
    const rows = aggregateIngredients([
      dish(ids.a, [['玉ねぎ', '1', '個']]),
      dish(ids.a, [['玉ねぎ', '1', '個']]),
    ]);
    expect(rows[0]).toMatchObject({ amountNumber: '2', sourceDishIds: [ids.a] });
  });

  it('入力が空なら行はない', () => {
    expect(aggregateIngredients([])).toEqual([]);
  });
});
