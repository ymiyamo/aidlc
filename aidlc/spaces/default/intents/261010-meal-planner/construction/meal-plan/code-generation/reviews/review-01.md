## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-12T09:46:10Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | db/migrations/004_meal_plan.sql > meal_plans / plan_days の制約 | DB は「1 献立 = startDate から連続する 7 日」を強制していません。`plan_days` は 0 件、1 件、8 件、非連続日付でも登録できます。実際に `src/db/__tests__/mealplan-schema.test.ts > 1 つの献立に同じ日は 1 件まで` は同一献立へ 2026-03-01 と 2026-03-02 の 2 日だけを登録して成功しており、画面の `toView` も取得できた行数をそのまま返します。データ不整合が入ると、7 日表示、空欄数、週のやり直し、買い物リストの対象が別々の件数で動きます。 | 7 日分と startDate からの連続性を DB トリガー等で強制するか、少なくともリポジトリの作成・読込境界で検証して不正な献立を fail closed にしてください。7 日 invariant を検証するスキーマテストも追加してください。 | New |
| R-02 | Major | db/migrations/004_meal_plan.sql > plan_days.household_id / dish_id の外部キー、src/repo/mealplan/index.ts > insertPlan | `plan_days.household_id` は `households` への単独 FK、`plan_id` は `meal_plans.plan_id` への単独 FK で、親献立と同じ household であることを DB が保証していません。`dish_id` も `dishes.dish_id` の単独 FK です。現在の通常 API は同じ値を渡しますが、SQL 直書き、将来の受け口、移行処理の一箇所の誤りで親・日・料理の所属が分裂し、読込側が親を `householdId` で絞る一方、日を別の重複列で絞る不整合になります。これは tenant 境界の防御をアプリケーション規約だけに依存させています。 | `meal_plans(plan_id, household_id)` と `plan_days(plan_id, household_id)` の複合 FK、および `dishes(dish_id, household_id)` と `plan_days(dish_id, household_id)` の所属整合性を DB で保証する設計に変更するか、重複した household_id を日行から削除して親から導出してください。既存データの不整合検査と、異なる household の組み合わせを拒否するスキーマテストを追加してください。 | New |
| R-03 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/meal-plan/code-generation/code-summary.md > 検証（実行して確認） / 未検証・注意、変更された共有ファイル全体 | コード概要自身が行カバレッジを「未計測」と記録していました。今回の確認では U4 の109テスト、型検査、lint は成功しましたが、`npm run test:coverage` の全体 Lines は 35.82% で、`src/api/router.ts` は 0%、`src/domain/suggestion.ts` は 32.45% でした。U4 のドメイン・リポジトリ・UI単体の高い値だけでは、今回変更した共有ファイル（router、http、dishes、suggestion、seed、validation、DishForm）の80%目標を証明できず、実際の本番ルーター経由のCSRF・認可経路もカバレッジ対象になっていません。 | 変更行ベースまたは共有ファイル単位で80%以上を判定できるカバレッジ設定を追加し、`handle()` を実際に通る認証・householdId境界・CSRF統合テストを含めて CI で実行してください。判定可能なカバレッジ証跡を `code-summary.md` と Build and Test の結果に反映してください。 | New |
| R-04 | Minor | src/domain/mealplan/index.ts > assignDish / redoDay の候補検証とトランザクション境界 | `assignDish` は `getPlanDishes`、`candidatePool`、`pickedList` を計画行のロック取得前に実行し、トランザクション内では再検証せず `updateDay` します。並行して料理が論理削除されたり除外条件が変わったりすると、削除済み・候補外の料理を割り当てる可能性があります。`redoDay` も候補プールを同じ境界の外で作っています。 | 計画行をロックした後に候補の所属・削除状態・除外状態を再検証し、状態が変わった場合は安全に拒否または再計算してください。削除/除外と割り当ての同時実行テストを追加してください。 | New |
| R-05 | Minor | src/ui/mealplan/MealPlanPanel.tsx > 360px 対応（WRAP / WRAP_ROW）、aidlc/spaces/default/intents/261010-meal-planner/construction/meal-plan/code-generation/code-summary.md > 未検証・注意 | UIコードと jsdom テストは確認済みですが、jsdom は実際のレイアウト幅や横スクロールを検証しません。コード概要にも「ブラウザでの見た目、360px 幅での横スクロールなしは目視していない」とあります。したがって、指定されたモバイル表示要件は未確認です。 | 360px の実ブラウザまたは Playwright 等で献立画面を開き、横スクロールがないこと、長い料理名・操作ボタン・保存済み一覧が折り返されることをスモークテストまたは記録で確認してください。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| `npx vitest run src/db/__tests__/mealplan-schema.test.ts src/repo/mealplan/__tests__ src/domain/mealplan/__tests__ src/api/routes/__tests__/mealplan.test.ts src/ui/mealplan/__tests__` | PASS: 6 files, 109 tests | U4 のデータモデル、リポジトリ、ドメイン、API ルート、UI の主要シナリオは成功しました。ただし、実際の `src/api/router.ts` はこのテスト経路を通りません。 |
| `npm run typecheck` | PASS | 型の不整合は検出されませんでした。 |
| `npm run lint` | PASS | lint エラーは検出されませんでした。 |
| `npm run test:coverage` | PASS: Lines 35.82% (3226/9005) | テストは成功しましたが、変更範囲全体の80%達成の証拠にはなりません。`src/api/router.ts` 0%、`src/domain/suggestion.ts` 32.45% を含みます。 |
| `src/db/__tests__/mealplan-schema.test.ts` | PASS: 6 tests | 状態組合せ、作業中1件、同日重複、保存時刻、cascade は確認していますが、7日数・連続日付・親子 household 所属は確認していません。 |

### Summary

UIコードは `MealPlanPanel.tsx`、`types.ts`、`page.tsx`、および `DishForm.tsx` と対応テストまで読み、未読ではありません。ただし実ブラウザの表示確認は未実施です。Blocker相当の即時実行失敗は確認しませんでしたが、7日 invariant、tenant 所属整合性、変更範囲の80%カバレッジ証跡という3件のMajorが残るため、現時点の判定は NOT-READY です。
