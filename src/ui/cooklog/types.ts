/** API が返す記録 1 件（src/domain/cooklog の CookRecordView と同じ形） */
export interface RecordDto {
  recordId: string;
  dishId: string;
  dishName: string;
  dishDeleted: boolean;
  cookedOn: string;
  impression: Impression | null;
  cautionMemo: string | null;
  memberLabel: string;
  createdAt: string;
}

export type Impression = 'again' | 'never_again';

export interface CalendarDayDto {
  date: string;
  count: number;
  label: string;
  impression: Impression | 'none';
}

export interface MonthDto {
  month: string;
  today: string;
  days: CalendarDayDto[];
  records: RecordDto[];
}

export interface RecordFormValues {
  cookedOn: string;
  impression: Impression | '';
  cautionMemo: string;
}

export const IMPRESSION_LABEL: Record<Impression, string> = {
  again: 'また作りたい',
  never_again: 'もう作りたくない',
};

export const IMPRESSION_MARK: Record<Impression, string> = {
  again: '👍',
  never_again: '👎',
};

/** 「2026-10-03」を「10月3日」にする（年は月の見出しに出す） */
export const dayText = (date: string) => {
  const [, m, d] = date.split('-');
  return `${Number(m)}月${Number(d)}日`;
};

/** 「2026-10」の前の月・次の月 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

/** 月の 1 日の曜日（0 = 日曜）と日数。カレンダーの並べ方に使う */
export function monthShape(month: string): { firstWeekday: number; days: number } {
  const [y, m] = month.split('-').map(Number);
  return {
    firstWeekday: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
    days: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
}
