# コード生成の計画：U5 作った記録（cook-log）

## Summary

- Builds: 料理ごとに「作った日」を何回でも記録（感想：また作りたい／もう作りたくない、注意点メモ）、編集・削除、記録のカレンダーと一覧、カレンダーの日付から作ったものを追加、「もう作りたくない」を候補の後ろにずらす
- Touches: `db/migrations/005_cook_log.sql`、`src/repo/cooklog/`、`src/domain/cooklog/`、`src/api/routes/cooklog.ts`、`src/app/records/`（新しいページ）、`src/ui/cooklog/`。既存の共有ファイルは最小限（下の一覧）
- Tests: 標準の戦略で約 35〜45 件（1 対多、同日の重複、未来日の拒否、カレンダーの集計、並び替え、他グループの拒否、画面の動作）

## 前提と決定（設計成果物から）

- 設計：`construction/cook-log/functional-design/`（BR40.x。READY のレビュー）。日付は日本時間。記録は Dish に 1 対多（CookRecord）。料理が論理削除されたときの記録の扱いは設計のとおり。
- 並び替え（US6.3）：U1 の候補の取得に「最新の感想が『もう作りたくない』の料理を後ろにずらす」拡張点を足す。

## 並行する他ユニットと衝突しないための規約

- 移行ファイルは `005_cook_log.sql` のみ（追加だけ）。
- 新しいコードはこのユニット専用のディレクトリに置く。**既存の共有ファイルを直す箇所**：`src/api/router.ts`（ルートの登録を 1 行）、`src/domain/suggestion.ts` と `src/repo/dishes.ts`（候補の並び替えの拡張点を 1 か所）、料理の詳細画面（`src/app/dishes/[id]/` に「作った日」の一覧と追加ボタンを置く 1 か所）。これ以外の既存ファイルは変えない。

## ストーリー → 計画のステップ

| ストーリー | ステップ |
|---|---|
| US6.2（作った日の追加、1 対多、編集・削除） | Step 3〜12 |
| US6.4（カレンダーで見る、一覧との切り替え） | Step 3〜12 |
| US6.5（カレンダーの日付から追加） | Step 3〜12 |
| US6.6（記録の編集・削除） | Step 3〜12 |
| US6.3（もう作りたくないを後ろへ） | Step 7〜10 |

## 計画のステップ

- [ ] **Step 1 — 骨組み**：このユニット用のディレクトリ（`src/repo/cooklog/`、`src/domain/cooklog/`、`src/api/routes/`、`src/ui/cooklog/`）。
- [ ] **Step 2 — テスト実行の準備**：U1 の Vitest の設定をそのまま使い、このユニットのテストだけを指すコマンドを `unit-test-instructions.md` に記録（実行して確かめる）。
- [ ] **Step 3 — データモデル（実装）**：`005_cook_log.sql`（CookRecord：householdId、dishId、memberId、cookedOn、impression、cautionMemo）。同じ料理の同じ日は 1 件までの一意制約、索引。
- [ ] **Step 4 — データモデルのテスト（書いて実行）**：同日の重複、1 対多、制約違反の扱い。
- [ ] **Step 5 — リポジトリ（実装）**：`src/repo/cooklog/`。すべての問い合わせは householdId で絞る。月ごとの取得、料理ごとの取得、最新の感想の取得。
- [ ] **Step 6 — リポジトリのテスト（書いて実行）**：他のグループの記録が見えない、日付の範囲。
- [ ] **Step 7 — 業務ロジック（実装）**：`src/domain/cooklog/`。BR40.x（未来日の拒否、同日の重複の案内、編集・削除、カレンダーの集計）。候補の並び替えの拡張点（最新が「もう作りたくない」なら後ろ）。
- [ ] **Step 8 — 業務ロジックのテスト（書いて実行）**：正常系と異常系、最新の記録が優先される並び替え。
- [ ] **Step 9 — API（実装）**：`src/api/routes/cooklog.ts`（追加・編集・削除、月の取得、料理ごとの一覧、追加用の料理の絞り込み）。
- [ ] **Step 10 — APIのテスト（書いて実行）**：未ログイン、他のグループ、CSRF、不正な日付。
- [ ] **Step 11 — 画面（実装）**：記録の画面（一覧／カレンダー切り替え、日をタップで一覧と「作ったものを追加」、追加の料理選択（最近選んだもの／お気に入り／すべて）、感想・メモ）。料理の詳細に「作った日」の一覧。`data-testid` とラベル。360px で横スクロールなし。
- [ ] **Step 12 — 画面のテスト（書いて実行）**：追加・編集・削除、カレンダーの表示、未来日の拒否。
- [ ] **Step 13 — 環境とドキュメント**：README に使い方（記録のデモの手順）を追記。
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
