/**
 * 分量の読み取りと足し算（BR20.5〜BR20.7）。
 * 浮動小数点では 0.1 + 0.2 が 0.30000000000000004 になるため、100 万分の 1 を 1 とする整数（BigInt）で数える。
 * 数として扱うのは、整数・小数（1.5）・単純な分数（1/2）で、0 より大きいものに限る
 */

const SCALE_DIGITS = 6;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

export type ParsedAmount =
  { kind: 'numeric'; micro: bigint } | { kind: 'text'; text: string } | { kind: 'none' };

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
const FRACTION = /^(\d+)\/(\d+)$/;

/**
 * 分量の文字列を読む。空は none。数として読めないもの（「少々」「2〜3」「1 と 1/2」）と、
 * 0（0、0.0、0/3）は、元の書き方のまま text にする（BR20.7）。全角の数字や記号は半角として読む
 */
export function parseAmount(raw: string | null | undefined): ParsedAmount {
  const original = (raw ?? '').trim();
  if (original === '') return { kind: 'none' };
  const normalized = original.normalize('NFKC').trim();

  let micro: bigint | null = null;
  const dec = DECIMAL.exec(normalized);
  if (dec) {
    const [, whole, frac = ''] = dec;
    // 小数第 7 位を四捨五入して、小数第 6 位までにする
    const digits = frac.padEnd(SCALE_DIGITS + 1, '0');
    micro = BigInt(whole) * SCALE + BigInt(digits.slice(0, SCALE_DIGITS));
    if (digits[SCALE_DIGITS] >= '5') micro += 1n;
  } else {
    const fr = FRACTION.exec(normalized);
    if (fr) {
      const num = BigInt(fr[1]);
      const den = BigInt(fr[2]);
      // 分母が 0 の分数は数ではない。四捨五入して小数第 6 位までにする
      if (den !== 0n) micro = (num * SCALE * 2n + den) / (den * 2n);
    }
  }
  if (micro === null || micro <= 0n) return { kind: 'text', text: original };
  return { kind: 'numeric', micro };
}

/** 保存用の 10 進の文字列（例：3、0.5、0.333333）。末尾の 0 は付けない */
export function toDecimalString(micro: bigint): string {
  const whole = micro / SCALE;
  const frac = (micro % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}` : `${whole}.${frac}`;
}

/** 保存した 10 進の文字列を、数えるための整数に戻す。読めなければ null */
export function fromDecimalString(s: string): bigint | null {
  const parsed = parseAmount(s);
  return parsed.kind === 'numeric' ? parsed.micro : null;
}

/** 同じ数の別の書き方（1.50 と 1.5）を同じ文字列にする。比べるときに使う */
export function normalizeDecimalString(s: string | null): string | null {
  if (s === null) return null;
  const micro = fromDecimalString(s);
  return micro === null ? s : toDecimalString(micro);
}

/**
 * 画面に出す分量（BR20.5）。整数なら整数、割り切れない小数は小数第 2 位まで四捨五入する。
 * 四捨五入で 0 になる極小の値だけは、見えなくならないよう保存した桁のまま出す
 */
export function displayAmount(micro: bigint): string {
  const hundredths = (micro + 5000n) / 10000n;
  if (hundredths === 0n) return toDecimalString(micro);
  const whole = hundredths / 100n;
  const cents = hundredths % 100n;
  if (cents === 0n) return `${whole}`;
  const frac = cents.toString().padStart(2, '0').replace(/0$/, '');
  return `${whole}.${frac}`;
}
