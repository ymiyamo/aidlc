import type { AppDeps } from '@/domain/deps';

/**
 * 契約 C2 の窓口 TasteExclusion（BR10.25）。
 * 候補の提案（Suggestion）が、除外する食材の一覧を好き嫌い（Taste）に聞くための型。
 * householdId は入口で確認済みの値を渡す。受け側は必ずこれで絞る（ADR-005）。
 * 呼び出しは再試行しない。失敗は握りつぶさず、そのまま上へ返す（食べられないものが出るより、出さないほうを選ぶ）
 */
export interface TasteExclusion {
  listExcludedIngredients(deps: AppDeps, householdId: string): Promise<string[]>;
}

/** 既定の実装：除外なし。Taste が使えない場面（本物を差し込む前）の土台 */
export const emptyTasteExclusion: TasteExclusion = {
  async listExcludedIngredients() {
    return [];
  },
};

// 本物の実装（src/domain/taste/index.ts）が、読み込まれたときに差し込む（U5 の setImpressionJudge と同じ形）
let current: TasteExclusion = emptyTasteExclusion;

export function setTasteExclusion(impl: TasteExclusion | null): void {
  current = impl ?? emptyTasteExclusion;
}

export const getTasteExclusion = (): TasteExclusion => current;
