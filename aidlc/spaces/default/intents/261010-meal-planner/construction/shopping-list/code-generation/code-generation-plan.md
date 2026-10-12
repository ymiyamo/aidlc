# コード生成の計画：U3 買い物リスト（shopping-list）

## Summary
- Builds: 「選んだもの」の材料を 1 つの買い物リストにまとめる（同じ材料・同じ単位は合算、数でない分量は料理ごとに別の行、材料が未入力の料理は案内の行）、チェックの付け外しと保存（家族で共有）、「買い物おわり」での完了と「選んだもの」の解除、献立（U4）から材料を受け取る受け口、グループ削除の受け口
- Touches: `db/migrations/003_shopping.sql`、`src/repo/shopping/`、`src/domain/shopping/`、`src/api/routes/shopping.ts`、`src/app/shopping/`、`src/ui/shopping/`。既存の共有ファイルは最小限（下の一覧）
- Tests: 標準の戦略で約 40〜50 件（合算の規則、単位違い、数でない分量、材料未入力の行、チェックの引き継ぎ、完了と解除のやり直し、他グループの拒否、画面の動作）

## 前提と決定（設計成果物から）
- 設計：`construction/shopping-list/functional-design/`（BR20.x）。買い物リストはグループで 1 つを共有する。数として扱う分量は整数・小数・単純な分数（1/2）に限る。分量が 0 のものは数として扱わない。表示は整数は整数、割り切れない小数は小数第 2 位まで四捨五入。
- 暫定（承認で確認）：分量 0 の扱いと小数の表示（上のとおり）。
- 「選んだもの」の一覧と外す操作は U1 の `src/domain/suggestion.ts`（`pickedList`、`unpick`）を呼ぶ。U3 は読むだけで、「買い物おわり」のときだけ外す。外し残しは `unpickDishIds` に保存して次回やり直す（BR20.13）。
- 料理の材料は U1 の `src/domain/dish.ts` の窓口から読む。食材名の正規化と単位の換算はしない。
- 献立（U4）から材料を受け取る入口 `composeFromIngredients` を `src/domain/shopping/` から export する（U4 が呼ぶ）。
## 並行する他ユニットと衝突しないための規約
- 移行ファイルは `003_shopping.sql` のみ（追加だけ。既存の移行は変更しない）。
- 新しいコードはこのユニット専用のディレクトリに置く。**既存の共有ファイルを直す箇所**：`src/api/router.ts`（`shoppingRoutes` の登録。オーケストレーターが行う）、ホーム等から買い物リストへの導線（最小限）。これ以外の既存ファイルは変えない。
## ストーリー → 計画のステップ
| ストーリー | ステップ |
|---|---|
| US2.6（選びなおしがリストに反映される） | Step 3〜12 |
| US3.1（選んだものから買い物リストができる） | Step 3〜12 |
| US3.2（買い物中にチェックを付ける） | Step 3〜12 |
| 献立からの受け取り（ADR-010） | Step 7〜10 |
## 計画のステップ
- [x] **Step 1 — 骨組み**：このユニット用のディレクトリ（`src/repo/shopping/`、`src/domain/shopping/`、`src/ui/shopping/`）。
- [x] **Step 2 — テスト実行の準備**：U1 の Vitest の設定をそのまま使い、このユニットのテストだけを指すコマンドを `unit-test-instructions.md` に記録（実行して確かめる）。
- [x] **Step 3 — データモデル（実装）**：`003_shopping.sql`（ShoppingList：householdId、source、sourcePlanId、status、completedAt、unpickDishIds、unpickDone。ShoppingItem：lineKey、kind、ingredientName、unit、amountKind、amountNumber、amountText、sourceDishIds、checked、checkedBy）。グループにつき作成中の picked のリストは 1 件までの一意制約。
- [x] **Step 4 — データモデルのテスト（書いて実行）**：一意制約、行の制約、リスト削除で行も消える。
- [x] **Step 5 — リポジトリ（実装）**：`src/repo/shopping/`。すべての問い合わせは householdId で絞る。リストの取得・作成、行の差し替え（1 つのトランザクション）、チェックの更新、完了。
- [x] **Step 6 — リポジトリのテスト（書いて実行）**：他のグループのリストが見えない、トランザクション、チェックの更新。
- [x] **Step 7 — 業務ロジック（実装）**：`src/domain/shopping/`。BR20.x（作成・同期、合算、単位違い、数でない分量、材料未入力の行、並び順、チェック、完了と解除のやり直し、献立からの受け取り、グループ削除の受け口）。
- [x] **Step 8 — 業務ロジックのテスト（書いて実行）**：設計の「集計の例」の表をそのままテストにする。正常系と異常系、同期でのチェックの引き継ぎと分量が変わったときの解除、「買い物おわり」の外し残しのやり直し。
- [x] **Step 9 — API（実装）**：`src/api/routes/shopping.ts`（リストを開く＝同期、チェックの付け外し、買い物おわり）。`shoppingRoutes` を export する。入口の CSRF・グループ決定は U1 のものを使う。
- [x] **Step 10 — APIのテスト（書いて実行）**：未ログイン、他のグループ、CSRF の欠落、完了済みのリストへのチェックの拒否。
- [x] **Step 11 — 画面（実装）**：`src/app/shopping/` と `src/ui/shopping/`（材料の行、チェック、材料未入力の案内、空のリストの案内、買い物おわり）。`data-testid` とラベル。360px で横スクロールなし。
- [x] **Step 12 — 画面のテスト（書いて実行）**：チェックの付け外し、空の表示、材料未入力の案内、買い物おわり。
- [x] **Step 13 — 環境とドキュメント**：README に使い方（買い物リストのデモの手順）を追記。
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
