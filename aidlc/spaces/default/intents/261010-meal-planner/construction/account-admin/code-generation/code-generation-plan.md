# コード生成の計画：U7 グループとアカウントの管理（account-admin）

## Summary

- Builds: 招待リンクの発行と参加、グループから抜ける、アカウント削除、パスワード再設定、ログイン失敗の制限（5 回で 15 分）、最後の 1 人が抜けたらグループ削除（メールは送らず、画面にリンクを表示する代替）
- Touches: `db/migrations/007_account_admin.sql`、`src/repo/admin/`、`src/domain/admin/`、`src/api/routes/admin.ts`、`src/app/`（招待・参加・設定の新しいページ）、`src/ui/admin/`。既存の共有ファイルは最小限（下の一覧）
- Tests: 標準の戦略で約 35〜45 件（一意性と同時実行、期限、ロック、退会後の表示、他グループの招待の拒否、画面の動作）

## 前提と決定（設計成果物から）

- 設計：`construction/account-admin/functional-design/`（BR50.x、レビュー指摘の修正を反映済み）。参加者の表示名は参加画面で入力（空なら U1 の既定）。参加・退会・グループ削除は同じグループで 1 件ずつ確定する。
- 暫定（承認で確認）：パスワード再設定の発行は 1 時間に 3 回まで（BR50.2）、アカウント削除の再入力は連続 5 回まちがえたら 15 分（BR50.19）。
- メールは実際には送らない。再設定リンクと招待リンクは画面に表示する（C5 のポートは差し替え可能な形で用意）。
- U1 の `Member`（leftAt、displayName）、`events`（アプリ内の出来事）を使う。

## 並行する他ユニットと衝突しないための規約

- 移行ファイルは `007_account_admin.sql` のみ（追加だけ。`001_init.sql` は変更しない）。
- 新しいコードはこのユニット専用のディレクトリに置く。**既存の共有ファイルを直す箇所**：`src/api/router.ts`（ルートの登録を 1 行）、`src/domain/events.ts`（出来事の種類の追加）、`src/repo/accounts.ts`（ログイン失敗の回数・ロック解除時刻の列の読み書きを足す）、`src/domain/auth.ts`（ログインでロックを確認する呼び出しを 1 か所）。これ以外の既存ファイルは変えない。

## ストーリー → 計画のステップ

| ストーリー | ステップ |
|---|---|
| US7.1（再設定、ログイン失敗の制限：AC7.1.2、AC7.1.3） | Step 3〜12 |
| US7.2（招待の発行と参加：AC7.2.1 の招待部分、AC7.2.2、AC7.2.3） | Step 3〜12 |
| US7.3（グループから抜ける） | Step 3〜12 |
| US7.4（アカウント削除） | Step 3〜12 |
| US7.5（最後の 1 人が抜けたらグループ削除） | Step 3〜12 |

## 計画のステップ

- [x] **Step 1 — 骨組み**：このユニット用のディレクトリ（`src/repo/admin/`、`src/domain/admin/`、`src/api/routes/`、`src/ui/admin/`）と、メール送信のポート（画面にリンクを出す既定の実装）。
- [x] **Step 2 — テスト実行の準備**：U1 の Vitest の設定をそのまま使い、このユニットのテストだけを指すコマンドを `unit-test-instructions.md` に記録（実行して確かめる）。
- [x] **Step 3 — データモデル（実装）**：`007_account_admin.sql`（Invitation、PasswordReset、Account への失敗回数とロック解除時刻の列、退会関連）。一意性・期限・使用済みの制約。
- [x] **Step 4 — データモデルのテスト（書いて実行）**：同じリンクを 2 人が同時に使っても 1 人だけ、期限、制約違反の扱い。
- [x] **Step 5 — リポジトリ（実装）**：`src/repo/admin/`。すべての問い合わせは householdId で絞る（招待は発行元のグループだけ）。
- [x] **Step 6 — リポジトリのテスト（書いて実行）**：他のグループの招待が使えない、削除済みの除外。
- [x] **Step 7 — 業務ロジック（実装）**：`src/domain/admin/`。BR50.x（発行、参加、退会、アカウント削除、再設定、ロック、最後の 1 人のグループ削除）。出来事（member-left、household.deleted、account.deleted）。参加・退会・削除の直列化。
- [x] **Step 8 — 業務ロジックのテスト（書いて実行）**：正常系と異常系（期限切れ、使用済み、5 回失敗でロック、15 分後に解除、2 人が同時に抜ける、参加と削除が同時）。
- [x] **Step 9 — API（実装）**：`src/api/routes/admin.ts`（招待の発行・参加、退会、アカウント削除、再設定の発行・実行）。入口の CSRF・グループ決定は U1 のものを使う。ログにパスワード・リンクの値を出さない。
- [x] **Step 10 — APIのテスト（書いて実行）**：未ログイン、他のグループ、CSRF の欠落、ロック中の表示、リンクの再利用。
- [x] **Step 11 — 画面（実装）**：招待リンクの発行と表示、参加ページ（表示名の入力）、設定ページ（グループから抜ける、アカウント削除、パスワード再設定）。`data-testid` とラベル。360px で横スクロールなし。
- [x] **Step 12 — 画面のテスト（書いて実行）**：参加の流れ、削除前の確認、エラー表示。
- [x] **Step 13 — 環境とドキュメント**：README に使い方（招待のデモの手順）を追記。
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
