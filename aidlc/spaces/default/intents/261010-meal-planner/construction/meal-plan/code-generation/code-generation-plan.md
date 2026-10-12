# コード生成の計画：U4 献立（meal-plan）

## Summary
- Builds: 1 週間（7 日分）の献立の提案（同じ料理は 1 回まで、同じ食材の種類が 3 日続かない、除外と並び替えは U2・U5 の結果をそのまま使う）、日ごと・週全体のやり直し、足りない日の空欄（理由と保存の案内つき）、保存と呼び出し、「この日は作らない」の設定・解除、「選んだもの」の日への手割り当て、この献立の買い物リストを作る（U3 に材料を渡す）
- Touches: `db/migrations/004_meal_plan.sql`、`src/repo/mealplan/`、`src/domain/mealplan/`、`src/api/routes/mealplan.ts`、`src/app/meal-plan/`、`src/ui/mealplan/`。**U1 の候補の取得と Dish を拡張する**（下の一覧）
- Tests: 標準の戦略で約 50〜60 件（提案の制約、乱数を固定した検証 V1〜V10、やり直し、作らない日、保存と呼び出し、買い物リストへの受け渡し、他グループの拒否、画面の動作）

## 前提と決定（設計成果物から）
- 設計：`construction/meal-plan/functional-design/`（BR30.x）。献立は常に 7 日。作業中の献立はグループにつき 1 件、保存済みは変わらない。提案では同じ料理は 1 回まで、手割り当てでは 2 回まで。
- 候補の母集団は「削除済みでない全部の料理（除外・並び替え後）」で、**「選んだもの」を除かない**。U1 の `listCandidateIds` に `includePicked` の指定を足し、献立は `includePicked: true` で呼ぶ（既存の呼び出しの挙動は変えない）。
- U1 の Dish に食材の種類（`ingredientKind`）を足す（BR30.19）。`004_meal_plan.sql` で列を追加し、初期データと保存・編集で値を保てるようにする。未設定の料理は「種類なし」として扱い、3 日続きの判定には使わない。
- 買い物リストへの受け渡しは、U3 の `composeFromIngredients`（`src/domain/shopping/`）を呼ぶ。assigned の日の料理だけを渡し、skip・空欄は含めない。
- 乱数は差し替えられる形にして、検証（V1〜V10）を固定の乱数列で行う。
## 並行する他ユニットと衝突しないための規約
- 移行ファイルは `004_meal_plan.sql` のみ（追加だけ。既存の移行は変更しない）。
- 新しいコードはこのユニット専用のディレクトリに置く。**既存の共有ファイルを直す箇所**：`src/api/router.ts`（`mealPlanRoutes` の登録。オーケストレーターが行う）、`src/repo/dishes.ts`（`listCandidateIds` の `includePicked`、`ingredientKind` の読み書き）、`src/domain/suggestion.ts`（献立用の候補の入口）、`src/domain/dish.ts` と料理の保存・編集画面（`ingredientKind` の入力）、ホームからの導線（最小限）。既存テストは緑のまま。
## ストーリー → 計画のステップ
| ストーリー | ステップ |
|---|---|
| US5.1（1 週間の献立を提案）、AC9.1.6（初期データだけで空欄 0） | Step 3〜12 |
| US5.2（日ごと・週全体のやり直し） | Step 7〜12 |
| US5.3（足りない日の空欄と案内） | Step 7〜12 |
| US5.4（保存と呼び出し） | Step 3〜12 |
| US5.5（作らない日、買い物リストを作る） | Step 7〜12 |
| US5.6（選んだものを日に割り当てる） | Step 7〜12 |
## 計画のステップ
- [x] **Step 1 — 骨組み**：このユニット用のディレクトリ（`src/repo/mealplan/`、`src/domain/mealplan/`、`src/ui/mealplan/`）。
- [x] **Step 2 — テスト実行の準備**：U1 の Vitest の設定をそのまま使い、このユニットのテストだけを指すコマンドを `unit-test-instructions.md` に記録（実行して確かめる）。
- [x] **Step 3 — データモデル（実装）**：`004_meal_plan.sql`（MealPlan、PlanDay、Dish への `ingredient_kind` 列の追加）。グループにつき作業中の献立は 1 件までの一意制約、1 つの献立に同じ日は 1 件までの一意制約。
- [x] **Step 4 — データモデルのテスト（書いて実行）**：一意制約、7 日、列の追加後も既存のデータが読める。
- [x] **Step 5 — リポジトリ（実装）**：`src/repo/mealplan/`、`src/repo/dishes.ts` の `includePicked` と `ingredientKind`。すべての問い合わせは householdId で絞る。
- [x] **Step 6 — リポジトリのテスト（書いて実行）**：他のグループの献立が見えない、`includePicked` の有無で選んだものの出方が変わる、既存の呼び出しは変わらない。
- [x] **Step 7 — 業務ロジック（実装）**：`src/domain/mealplan/`。BR30.x（提案の探索、やり直し、作らない日、手割り当て、保存・呼び出し、買い物リストの受け渡し、グループ削除の受け口）。
- [x] **Step 8 — 業務ロジックのテスト（書いて実行）**：設計の「提案の決め方を検証する」V1〜V10 を固定の乱数でテストにする。正常系と異常系。
- [x] **Step 9 — API（実装）**：`src/api/routes/mealplan.ts`（提案、日のやり直し、週のやり直し、作らない・解除、割り当て、保存、一覧、呼び出し、買い物リストを作る）。`mealPlanRoutes` を export する。入口の CSRF・グループ決定は U1 のものを使う。
- [x] **Step 10 — APIのテスト（書いて実行）**：未ログイン、他のグループ、CSRF の欠落、保存済みの献立への変更の拒否。
- [x] **Step 11 — 画面（実装）**：`src/app/meal-plan/` と `src/ui/mealplan/`（7 日の表示、やり直し、作らない日、選んだものの割り当て、保存と呼び出し、空欄の理由と保存の案内、買い物リストを作る）。料理の保存・編集画面に食材の種類の入力。`data-testid` とラベル。360px で横スクロールなし。
- [x] **Step 12 — 画面のテスト（書いて実行）**：7 日の表示、空欄の案内、作らない日、割り当て、保存・呼び出し。
- [x] **Step 13 — 環境とドキュメント**：README に使い方（献立のデモの手順）を追記。
- [ ] **Step 14 — 追跡**：`code-summary.md`、`traceability.json`、`source-manifest.json`。

## Testing Contract
```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "team",
  "ordering": "テスト可能な層を実装したあと、その層のテストを書いて実行する。",
  "scope": "classic",
  "test_strategy": "standard",
  "project_type": "greenfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: test-after\n- **Methodology evidence**: Q3 で A（実装してからテストを書く）を選択。組織の既定と同じ。\n- **Ordering**: テスト可能な層を実装したあと、その層のテストを書いて実行する。\n- 行カバレッジ 80% 以上の下限は、通し版（walking skeleton）の後に追加・変更するコードに適用する。通し版そのものには適用しない。CI でテストを実行してからマージする。"
    }
  ],
  "obligations": {
    "strategy": "standard",
    "strategy_volume": [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:d48dba9b9b17c8603b6f46d28c1246971727d6e30384ae7ce466ae9dfb3c704a",
  "contract_sha256": "sha256:c74fc5e93f51255f22264b502cac259c82104f71c59034f6d68c65d74ee322bf"
}
```
