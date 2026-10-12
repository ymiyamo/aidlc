/**
 * 日付はすべて日本時間（Asia/Tokyo）の暦の日として扱う（BR40.22）。
 * 端末の時刻や時差に左右されないよう、UTC に 9 時間を足して文字列にする（日本は夏時間がない）
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の今日（YYYY-MM-DD） */
export const todayJst = (now: Date): string =>
  new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** 実在する日付か（2026-02-30 のようなものは false） */
export function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12) return false;
  return d >= 1 && d <= daysInMonth(y, mo);
}

/** 日本時間の今月（YYYY-MM） */
export const currentMonthJst = (now: Date): string => todayJst(now).slice(0, 7);

/** 「年-月」の形で、実在する月か */
export function isRealMonth(s: string): boolean {
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  return y >= 1 && mo >= 1 && mo <= 12;
}

/** 月の最初の日と最後の日（両端を含む）。形が正しくなければ null */
export function monthRange(month: string): { from: string; to: string } | null {
  if (!isRealMonth(month)) return null;
  const [y, mo] = month.split('-').map(Number);
  const last = String(daysInMonth(y, mo)).padStart(2, '0');
  return { from: `${month}-01`, to: `${month}-${last}` };
}
