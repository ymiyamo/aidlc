# 単体テストの手順：U7 account-admin

## 方針

- 標準の戦略（コンポーネントあたり 5〜8 件の単体テスト＋主要な境界の統合テスト）。手法は test-after。通し版の後の変更なので、行カバレッジ 80% 以上を目標にする（`team.md`）。
- U1 の Vitest の設定とテスト用の補助（`src/test-helpers/`、PGlite のメモリ上のデータベース）をそのまま使う。

## このユニットだけのテストの実行コマンド

| 層 | 実行コマンド |
|---|---|
| データモデル | `npx vitest run src/db/__tests__/admin-schema.test.ts` |
| リポジトリ | `npx vitest run src/repo/admin/__tests__` |
| 業務ロジック | `npx vitest run src/domain/admin/__tests__` |
| API | `npx vitest run src/api/routes/__tests__/admin.test.ts` |
| 画面 | `npx vitest run src/ui/admin/__tests__` |
| U7 全体 | `npx vitest run src/db/__tests__/admin-schema.test.ts src/repo/admin/__tests__ src/domain/admin/__tests__ src/api/routes/__tests__/admin.test.ts src/ui/admin/__tests__` |

## 必ず入れるテスト

- 同じ招待リンクを 2 人が同時に使っても、参加できるのは 1 人だけ。
- 期限（7 日）を過ぎた招待は使えない。使用済みも使えない。
- 他のグループの招待は、発行も参加も確認できない。
- ログイン失敗 5 回で 15 分ロックされ、時間が過ぎると解除される（時刻は差し替える）。
- 2 人が同時に抜けるとき、最後に確定した人がグループを削除する。参加とグループ削除が同時でも、存在しないグループの Member ができない。
- アカウント削除後、保存した料理は残り、保存した人の名前は「退会したメンバー」と表示される。
- ログとレスポンスに、パスワード、リンクの値が出ない。
