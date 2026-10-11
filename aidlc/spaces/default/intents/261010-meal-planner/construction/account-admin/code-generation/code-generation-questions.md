# Code Generation Plan Approval

AI-DLC writes this file when it asks you to approve the plan. To answer here
instead of in chat, write your answer after `[Answer]:` and say done.

## Plan Approval

Approve these 4 code plans?

- Builds: 招待リンクの発行と参加、グループから抜ける、アカウント削除、パスワード再設定、ログイン失敗の制限（5 回で 15 分）、最後の 1 人が抜けたらグループ削除（メールは送らず、画面にリンクを表示する代替）
- Touches: `db/migrations/007_account_admin.sql`、`src/repo/admin/`、`src/domain/admin/`、`src/api/routes/admin.ts`、`src/app/`（招待・参加・設定の新しいページ）、`src/ui/admin/`。既存の共有ファイルは最小限（下の一覧）
- Tests: 標準の戦略で約 35〜45 件（一意性と同時実行、期限、ロック、退会後の表示、他グループの招待の拒否、画面の動作）

Full plan: aidlc/spaces/default/intents/261010-meal-planner/construction/account-admin/code-generation/code-generation-plan.md
Test instructions: aidlc/spaces/default/intents/261010-meal-planner/construction/account-admin/code-generation/unit-test-instructions.md

[Approval Fingerprint]: sha256:v3:0567c235df3792a9e70541f62af9210cb9f8a1b38f48825c9142de7471b55484
[Planned Source]: 1e9f2962b38c2a6df8ca9ee7eee9ecac83e28b3d43a5ce5a578936bc17c3443b

- A. Approve all
- B. Request Changes
- C. I'll edit the files

[Answer]: Approve Plan
