# コード生成の計画：U6 画像（images）

## Summary

- Builds: 利用者が登録する画像（5MB 以内、画像のみ、グループの外には見えない）の保存と表示、画像のない料理には「AI が作ったイメージ」の印つきのダミー画像（生成 AI は差し替え可能な入口だけ）、初期データの画像の差し替え
- Touches: `db/migrations/006_images.sql`、`src/lib/storage/`（ファイル保管の抽象。ローカルはディスク）、`src/repo/images/`、`src/domain/images/`、`src/api/routes/images.ts`、`src/ui/images/`。既存の共有ファイルは最小限（下の一覧）
- Tests: 標準の戦略で約 25〜35 件（サイズ上限、種類の確認、他グループの拒否、pending の期限、ダミー画像、画面の動作）

## 前提と決定（設計成果物から）

- 設計：`construction/images/functional-design/`（BR60.x、レビュー指摘の修正を反映済み）。新規保存は「先に料理を保存し、そのあと画像を登録する」2 段階。作成中（pending）の画像は 10 分で失敗扱いにして再要求できる。
- 生成 AI のサービスは未決定のため、本物は作らない。C4 の入口（差し替え可能なポート）と、ローカルで作る固定の絵（色と料理名の頭文字）のダミーで代える。画像の「AI が作ったイメージ」の印は付ける。
- ファイルの保管は、ローカルではディスク（`.data/images/`）、AWS では保管場所（骨組みの TODO）という抽象で書く。

## 並行する他ユニットと衝突しないための規約

- 移行ファイルは `006_images.sql` のみ（追加だけ）。
- 新しいコードはこのユニット専用のディレクトリに置く。**既存の共有ファイルを直す箇所**：`src/api/router.ts`（ルートの登録を 1 行）、候補のカード `src/ui/DishCard.tsx` と料理の保存・編集画面 `src/ui/DishForm.tsx`（画像の表示と選ぶ入力を差し込む 1 か所ずつ）。これ以外の既存ファイルは変えない。

## ストーリー → 計画のステップ

| ストーリー | ステップ |
|---|---|
| US1.5（AC1.5.1 AI の画像と印、AC1.5.2 登録した画像、AC1.5.3 サイズ・種類の拒否、AC1.5.4 他グループは見えない） | Step 3〜12 |
| AC9.1.7、AC9.1.8（初期データの画像） | Step 7、Step 13 |

## 計画のステップ

- [ ] **Step 1 — 骨組み**：ディレクトリ（`src/lib/storage/`、`src/repo/images/`、`src/domain/images/`、`src/ui/images/`）と、ファイル保管のポート（ディスクの既定の実装）。
- [ ] **Step 2 — テスト実行の準備**：U1 の Vitest の設定をそのまま使い、このユニットのテストだけを指すコマンドを `unit-test-instructions.md` に記録（実行して確かめる）。
- [ ] **Step 3 — データモデル（実装）**：`006_images.sql`（RegisteredImage、GeneratedImage：状態 pending／ready／failed、requestedAt）。料理ごとに登録画像は 1 件までの一意制約。
- [ ] **Step 4 — データモデルのテスト（書いて実行）**：一意制約、状態の制約。
- [ ] **Step 5 — リポジトリ（実装）**：`src/repo/images/`。すべての問い合わせは householdId で絞る。ファイルの保管の抽象。
- [ ] **Step 6 — リポジトリのテスト（書いて実行）**：他のグループの画像が見えない、保管の読み書き。
- [ ] **Step 7 — 業務ロジック（実装）**：`src/domain/images/`。BR60.x（サイズ 5MB、画像の種類の確認（中身の先頭バイトで判定）、登録で AI の画像を置き換える、pending の期限、ダミー画像の作成、初期データの画像の差し替え）。
- [ ] **Step 8 — 業務ロジックのテスト（書いて実行）**：5MB 超と画像でないファイルの拒否、登録後に AI の画像が出ない、pending が 10 分で再要求できる。
- [ ] **Step 9 — API（実装）**：`src/api/routes/images.ts`（登録、取得、削除、AI 画像の要求）。取得は認証とグループの確認を必ず通す（画像の URL を知っていても他グループは見られない）。
- [ ] **Step 10 — APIのテスト（書いて実行）**：未ログイン、他のグループ、CSRF、不正なファイル。
- [ ] **Step 11 — 画面（実装）**：候補のカードと詳細に画像（なければ印つきのダミー）、保存・編集画面に画像を選ぶ入力（保存後に登録）。`data-testid` とラベル。
- [ ] **Step 12 — 画面のテスト（書いて実行）**：画像の表示、印の表示、エラーの理由の表示。
- [ ] **Step 13 — 環境とドキュメント**：初期データの画像の差し替え手順を README に追記。
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
