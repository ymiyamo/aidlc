import type { ItemContent } from '@/repo/shopping';
import { displayAmount, parseAmount, toDecimalString } from './amount';

/** 買い物リストの元になる材料 1 行（料理の材料と同じ形） */
export interface ComposeIngredient {
  name: string;
  amount: string | null;
  unit: string | null;
}

/** 買い物リストの元になる料理 1 つ。材料が 0 行なら「材料の入力が必要」の行になる（BR20.8） */
export interface ComposeDish {
  dishId: string;
  name: string;
  ingredients: ComposeIngredient[];
}

/**
 * 行の同一性の印（BR20.5〜BR20.8）。区切り文字の取り違えを避けるため、配列を JSON にして作る。
 * 数の分量は「材料名 + 単位」、数でない分量・空は「材料名 + 単位 + 分量の書き方 + 料理」、入力が必要な行は「料理」
 */
const key = (...parts: string[]) => JSON.stringify(parts);

interface Accumulator {
  content: ItemContent;
  micro?: bigint;
}

/**
 * BR20.4〜BR20.8：選んだ料理の材料を、買い物リストの行にまとめる（純粋な計算。保存はしない）。
 * - 材料名と単位が同じで、分量が数として扱えるものは、10 進で正確に足して 1 行（単位違いは別の行）
 * - 数でない分量と空は、足さずに料理ごとの行（同じ料理の同じ書き方は 1 行）
 * - 材料が 0 行の料理は、料理 1 つにつき「材料の入力が必要」の行
 * 食材名の読み替えと単位の換算はしない（前後の空白を除いた文字が完全に同じなら同じ。Q2 A）
 */
export function aggregateIngredients(dishes: ComposeDish[]): ItemContent[] {
  const lines = new Map<string, Accumulator>();

  for (const dish of dishes) {
    const usable = dish.ingredients
      .map((i) => ({ name: i.name.trim(), amount: i.amount, unit: (i.unit ?? '').trim() }))
      .filter((i) => i.name !== '');

    if (usable.length === 0) {
      const lineKey = key('i', dish.dishId);
      if (!lines.has(lineKey)) {
        lines.set(lineKey, {
          content: {
            lineKey,
            kind: 'needsInput',
            ingredientName: null,
            unit: '',
            amountKind: null,
            amountNumber: null,
            amountText: null,
            sourceDishIds: [dish.dishId],
          },
        });
      }
      continue;
    }

    for (const ing of usable) {
      const parsed = parseAmount(ing.amount);
      if (parsed.kind === 'numeric') {
        const lineKey = key('n', ing.name, ing.unit);
        const acc = lines.get(lineKey);
        if (acc) {
          acc.micro = (acc.micro ?? 0n) + parsed.micro;
          if (!acc.content.sourceDishIds.includes(dish.dishId)) {
            acc.content.sourceDishIds.push(dish.dishId);
          }
        } else {
          lines.set(lineKey, {
            micro: parsed.micro,
            content: {
              lineKey,
              kind: 'ingredient',
              ingredientName: ing.name,
              unit: ing.unit,
              amountKind: 'numeric',
              amountNumber: null,
              amountText: null,
              sourceDishIds: [dish.dishId],
            },
          });
        }
        continue;
      }

      const text = parsed.kind === 'text' ? parsed.text : '';
      const lineKey =
        parsed.kind === 'text'
          ? key('t', ing.name, ing.unit, text, dish.dishId)
          : key('x', ing.name, ing.unit, dish.dishId);
      if (!lines.has(lineKey)) {
        lines.set(lineKey, {
          content: {
            lineKey,
            kind: 'ingredient',
            ingredientName: ing.name,
            unit: ing.unit,
            amountKind: parsed.kind === 'text' ? 'text' : 'none',
            amountNumber: null,
            amountText: parsed.kind === 'text' ? text : null,
            sourceDishIds: [dish.dishId],
          },
        });
      }
    }
  }

  return [...lines.values()].map((acc) => {
    if (acc.micro !== undefined) {
      acc.content.amountNumber = toDecimalString(acc.micro);
      acc.content.amountText = displayAmount(acc.micro);
    }
    return acc.content;
  });
}
