# コード生成の計画：U1 最小の通し版（skeleton）

## Summary

- Builds: 登録・ログイン、家族グループの作成と初期データ 30 件、料理の保存・編集・削除・お気に入り、買い物前の候補のスワイプと「選んだもの」（スマートフォン向けの Web アプリ。TypeScript）
- Touches: リポジトリのルートに新規作成（`src/`、`db/migrations/`、`data/seed-dishes.json`、`infra/`（AWS の構成コード。合成のみで、実際には作らない）、`.github/workflows/`、`docker-compose.yml`、`README.md`）
- Tests: 標準の戦略で約 40〜50 件（データベースの制約、リポジトリ、業務ルール、API、画面の動作）。通し版そのものには行カバレッジ 80% の下限を適用しない（`team.md`）。ただし、グループの範囲と同時実行の一意性は必ずテストする

## 前提と決定（設計成果物から）

- 技術：TypeScript、Node.js、Next.js（App Router）、PostgreSQL（`tech-stack-decisions.md`）。
- ローカルで早く触るため、データベースは次の 2 通りで動くようにする（[assumption]。Q7 A の「コンテナのデータベース」に加える便宜）：(1) `DATABASE_URL` があれば PostgreSQL（`docker-compose.yml` のコンテナ）に接続、(2) なければ、インストール不要で動く組み込みの PostgreSQL（PGlite）に `.data/` へ保存して接続。テストは (2) で、外部の準備なしに走る。
- AWS には作らない（Q7 A）。構成コード（`infra/`）は、合成と差分の確認まで。
- 画像は使わない（色の枠）。メールは送らない。

## ストーリー → 計画のステップ

| ストーリー | 計画のステップ |
|---|---|
| US7.1（登録、ログイン） | Step 3〜10 |
| US7.2（グループ作成） | Step 3〜10 |
| US9.1（初期データ 30 件） | Step 3〜8、Step 10 |
| US1.1〜US1.4（保存、詳しい情報、少ない操作、共有） | Step 3〜12 |
| US2.1、US2.4（候補とスワイプ、0 件の案内） | Step 3〜12 |
| US6.1（お気に入り） | Step 3〜12 |

## 計画のステップ

- [x] **Step 1 — プロジェクトの骨組みと本番の設定**：`package.json`、`tsconfig.json`、Next.js の設定、ESLint と Prettier の設定（`team.md`）、`.gitignore`（`.data/`、`.env*` を含める）、`.env.example`。（NFR3.13、NFR6.2）
- [x] **Step 2 — テスト実行の準備**：Vitest の設定と、単体で動かす実行コマンドを `unit-test-instructions.md` に記録する。データベースのテスト用の準備（PGlite、1 テストごとに初期化）。
- [x] **Step 3 — データモデル／データベースの動作（実装）**：`db/migrations/` に、Account、LoginSession、Household、Member、Dish、DishIngredient、PickedItem の表と、一意制約を作る。メールの一意（大文字小文字無視）、有効な Member は 1 アカウントにつき最大 1 件（部分的な一意制約）、PickedItem は（グループ、料理）で一意、初期データは（グループ、seedKey）で一意。索引も作る。（`entities.md`、NFR7.4〜7.7、BR1.2、BR2.1、BR3.12、BR4.7）
- [x] **Step 4 — データモデルのテスト（書いて実行）**：各一意制約の違反、同時の登録に対して 1 件のままになること、論理削除の列、を確かめる。
- [x] **Step 5 — リポジトリ／データアクセス（実装）**：データベースの接続の部品（`pg` と PGlite の切り替え）。各表の読み書き。**すべての問い合わせが householdId を必須の引数にする**形にする。（NFR3.5〜3.7、ADR-005）
- [x] **Step 6 — リポジトリのテスト（書いて実行）**：他のグループのデータが読み取り・書き込みの両方で見えないこと。削除済みの除外。
- [x] **Step 7 — 業務ロジック（実装）**：BR1.1〜BR1.6（パスワード 8 文字以上、変換して保存、30 日のログイン状態）、BR2.1〜BR2.6、BR3.1〜BR3.15（検証、重複 URL の確認、編集・削除、お気に入り、一覧）、BR3.12（初期データの冪等な登録と、ホームを開いたときの補完）、BR4.1〜BR4.11（ランダムな候補、見た一覧の除外、選んだもの）。初期データ 30 件のデータファイル `data/seed-dishes.json`（和食中心、洋食、中華。ダミーの URL）を作る。出来事（household.created）は、アプリ内の呼び出しで実装し、受け手は冪等にする。
- [x] **Step 8 — 業務ロジックのテスト（書いて実行）**：各ルールの正常系と異常系（文字数の上限、URL の形式、タグの上限、重複 URL、候補が見終わる、パスが再び出ない、選んだものが除かれる）。初期データの冪等性。
- [x] **Step 9 — API／エンドポイント（実装）**：登録、ログイン、ログアウト、グループ作成、メンバー一覧、料理の一覧・保存・編集・削除・お気に入り、候補の取得、選んだものの追加・取得・削除、`/healthz`。入口で、HTTPS 前提の Cookie（HttpOnly、Secure、SameSite）、本人確認、グループの決定、Origin の照合と合言葉（CSRF）、リクエストの識別子、構造化ログ（個人情報を伏せる）を行う。入力の検証は 1 つの部品にまとめる。（NFR3.1〜3.14、NFR4.11〜4.13）
- [x] **Step 10 — APIのテスト（書いて実行）**：未ログイン、他のグループの ID、CSRF の欠落、不正な入力、ログの伏せ字。登録→グループ作成→保存→候補→選ぶ、の流れ（検証コマンド、NFR6.3）。
- [x] **Step 11 — 画面（実装）**：スマートフォン向け（幅 360px で横スクロールなし）。登録・ログイン、グループ作成、ホーム（「買い物前」の入口は 1 回の操作）、買い物前（大きなカード、スワイプとボタン、見終えた表示、「最初から見る」、0 件の案内、「材料が未入力」）、保存の画面（1 画面完結、右下の「＋」、「貼り付けて保存」）、料理の一覧と詳細（編集・削除・お気に入り）、「選んだもの」。操作要素に `data-testid` とラベルを付ける。コントラスト 4.5:1 以上。（NFR1.1〜1.6）
- [x] **Step 12 — 画面のテスト（書いて実行）**：候補の操作（ボタンとスワイプの結果が同じ）、保存の検証の表示、見終えた表示。
- [x] **Step 13 — 環境とビルドの設定**：`docker-compose.yml`（PostgreSQL）、GitHub Actions の確認用の流れ（整形、lint、型、テスト）、`infra/`（CDK の構成コード。合成と差分のみ）、移行の実行スクリプト、ローカルの起動手順。
- [x] **Step 14 — 文書とトレーサビリティ**：`README.md`（ローカルの起動、テストの実行）、`code-summary.md`、`traceability.json`、`source-manifest.json`。

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
