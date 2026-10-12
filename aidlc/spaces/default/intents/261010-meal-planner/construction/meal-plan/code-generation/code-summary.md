# コード生成の概要：U4 献立（meal-plan）

## 作ったもの
- 移行 `db/migrations/004_meal_plan.sql` と追加移行 `db/migrations/008_meal_plan_integrity.sql`（献立、7 日分の PlanDay、料理の食材の種類、複合 FK、7 日連続制約）
- リポジトリ `src/repo/mealplan/`、業務ロジック `src/domain/mealplan/`、API `src/api/routes/mealplan.ts`
- 画面 `src/ui/mealplan/`、ページ `src/app/meal-plan/`（7日提案、日・週のやり直し、作らない日、保存・呼び出し、買い物リスト作成）
- 既存の共有ファイルの変更：`src/api/router.ts`（`mealPlanRoutes` の登録）、候補取得の `includePicked`、料理の `ingredientKind`、初期データと料理フォーム、ホーム導線、`README.md`
- 初期データで、同じ料理を1回まで・同じ食材種別を3日連続させない制約を検証できる実装とテストを追加。
- レビュー修正として、作成・読込境界の7日連続 invariant 検証、`meal_plans`・`plan_days`・`dishes` の household 所属を保証する複合 FK、実 `handle()` 経由の認証・CSRF・household 境界テストを追加。

## 検証（実行して確認）
- 変更前ベースライン：`npm run test:unit` は 43 ファイル、717 件すべて成功。
- `npm run typecheck && npm run lint && npm run test:unit`：型検査成功、lint 成功、43 ファイル・719 件すべて成功（既存テストの回帰なし）。
- R-01/R-02：`npx vitest run src/db/__tests__/mealplan-schema.test.ts`、8 件すべて成功。0/1/8 日、非連続日、親献立・日行・料理の異なる household の組み合わせを拒否することを確認。
- 実 API 経路：`npx vitest run src/api/routes/__tests__/mealplan.test.ts`、14 件すべて成功。テスト用のルート直呼び出しではなく `src/api/router.ts` の `handle()` を通過。
- カバレッジコマンド：`npm run test:coverage`、719 件成功。`vitest.config.ts` の `coverage.include` で R-03 の変更共有ファイル8ファイルを明示し、`thresholds.lines: 80` を設定。
- 変更範囲 Lines：全対象 98.68%。内訳は `src/api/router.ts` 97.33%、`src/api/http.ts` 100%、`src/repo/dishes.ts` 100%、`src/domain/suggestion.ts` 93.85%、`src/domain/seed.ts` 100%、`src/domain/validation.ts` 100%、`src/ui/DishForm.tsx` 100%、`src/ui/types.ts` 100%。80%閾値を実測で通過。

## 未検証・注意
- ブラウザでの見た目、360px 幅での横スクロールなしは目視していない（jsdom と API テストまで）。実ブラウザ確認は今回の必須修正対象外。
- AWS へのデプロイ・操作はしていない。
- U2/U5 の除外・並べ替えを使う候補入口と、U3 の `composeFromIngredients` に接続している。
- 追跡ファイルの対応先は、受け入れ基準を実装モジュール単位にまとめている。
