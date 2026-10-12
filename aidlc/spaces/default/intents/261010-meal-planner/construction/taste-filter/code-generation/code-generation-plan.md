# コード生成の計画：U2 好き嫌いと絞り込み（taste-filter）

## Summary

- Builds: 嫌いな食材の登録（グループの全員分を共有して見える）、食材名の文字列一致で候補から除外、「今日の気分」（調理時間・手間・気分タグ）での絞り込みと該当件数、おまかせ、外で探す（検索画面を開くだけ）、絞り込み 0 件の案内
- Touches: `db/migrations/002_taste.sql`、`src/repo/taste/`、`src/domain/taste/`、`src/api/routes/taste.ts`、`src/app/taste/`、`src/ui/taste/`。**U1 の候補の取得を拡張する**（下の一覧）
- Tests: 標準の戦略で約 40〜50 件（除外の一致、絞り込みの組み合わせ、件数、おまかせ、他グループの拒否、現在のメンバーだけの除外、画面の動作）

## 前提と決定（設計成果物から）

- 設計：`construction/taste-filter/functional-design/`（BR10.x、レビュー指摘の修正を反映済み）。調理時間の名前は U1 の実装の `over30`（`cookTime`）を正とする。除外は「現在のメンバー（退会していない人）の登録だけ」から作る。アレルギー・表記ゆれの正規化は作らない。
- U1 には TasteExclusion の窓口も既定の実装もないため、**このユニットで新設する**：`src/domain/taste/`（窓口と本物の実装）、U1 の `nextCandidate` に絞り込みの条件・除外・件数・おまかせの入口を足す。
- 契約 C1・C2 の `longer`／`cookTimeBand` を `over30`／`cookTime` に直す後続作業と、件数・気分タグの選択肢を返す窓口の追加は、このユニットのコード生成で行う（`contract-summary.md` の該当箇所を直す）。

## 並行する他ユニットと衝突しないための規約

- 移行ファイルは `002_taste.sql` のみ（追加だけ）。
- 新しいコードはこのユニット専用のディレクトリに置く。**既存の共有ファイルを直す箇所**：`src/api/router.ts`（ルートの登録を 1 行）、`src/domain/suggestion.ts` と `src/repo/dishes.ts`（候補の取得に絞り込み・除外の条件を足す。**このユニットがこの 2 ファイルの主な持ち主**）、「買い物前」の画面（`src/app/suggest/` と `src/ui/SuggestionDeck.tsx` に「今日の気分」のシートを差し込む 1 か所）。これ以外の既存ファイルは変えない。

## ストーリー → 計画のステップ

| ストーリー | ステップ |
|---|---|
| US4.1（好き嫌いを登録）、US4.3（文字列の一致） | Step 3〜12 |
| US2.3（食べられないものを候補から外す） | Step 5〜12 |
| US2.2（今日の気分で絞り込み） | Step 5〜12 |
| US2.5（おまかせ・外で探す） | Step 7〜12 |
| US2.4（絞り込み 0 件の案内：AC2.4.2） | Step 7〜12 |

## 計画のステップ

- [x] **Step 1 — 骨組み**：ディレクトリ（`src/repo/taste/`、`src/domain/taste/`、`src/api/routes/`、`src/ui/taste/`）と、TasteExclusion の窓口の型。
- [x] **Step 2 — テスト実行の準備**：U1 の Vitest の設定をそのまま使い、このユニットのテストだけを指すコマンドを `unit-test-instructions.md` に記録（実行して確かめる）。
- [x] **Step 3 — データモデル（実装）**：`002_taste.sql`（DislikedIngredient：householdId、memberId、ingredientName、registeredAt）。同じメンバーの同じ食材は 1 件までの一意制約。
- [x] **Step 4 — データモデルのテスト（書いて実行）**：一意制約、重複登録の扱い。
- [x] **Step 5 — リポジトリ（実装）**：`src/repo/taste/`、`src/repo/dishes.ts` の候補の取得に絞り込み（調理時間・手間・タグ）と除外（食材の文字列一致）と件数を足す。すべての問い合わせは householdId で絞る。
- [x] **Step 6 — リポジトリのテスト（書いて実行）**：絞り込みの組み合わせ、除外の一致（「えび」と「海老」は別）、他のグループが見えない、現在のメンバーだけ。
- [x] **Step 7 — 業務ロジック（実装）**：`src/domain/taste/`、`src/domain/suggestion.ts` の拡張。BR10.x（登録・解除、除外の一覧、絞り込み、件数、おまかせ、外で探すの検索 URL、0 件の案内）。気分タグの選択肢の取得。
- [x] **Step 8 — 業務ロジックのテスト（書いて実行）**：正常系と異常系、既存の U1 の候補のテスト（パス、選んだもの、見終えた）が緑のまま。
- [x] **Step 9 — API（実装）**：`src/api/routes/taste.ts`（嫌いな食材の登録・解除・一覧、条件に合う件数、気分タグの選択肢、おまかせ）、候補の取得に絞り込みの条件を受け取る入口を足す。契約の文書を直す。
- [x] **Step 10 — APIのテスト（書いて実行）**：未ログイン、他のグループ、CSRF、不正な条件。
- [x] **Step 11 — 画面（実装）**：「今日の気分」のシート（大きな選択肢、横スクロールなし、件数の表示、「見る」）、嫌いな食材の登録画面、おまかせ、外で探す、0 件の案内。`data-testid` とラベル。
- [x] **Step 12 — 画面のテスト（書いて実行）**：シートの選択と件数、0 件の案内、登録と解除。
- [x] **Step 13 — 環境とドキュメント**：README に使い方（絞り込みと除外のデモの手順）を追記。
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
