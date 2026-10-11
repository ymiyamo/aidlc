# 単体テストの手順：U5 cook-log

## 方針

- 標準の戦略。手法は test-after。通し版の後の変更なので、行カバレッジ 80% 以上を目標にする（`team.md`）。
- U1 の Vitest の設定とテスト用の補助（PGlite のメモリ上のデータベース）をそのまま使う。日付は差し替えられるようにする（日本時間の「今日」を固定）。

## このユニットだけのテストの実行コマンド

| 層 | 実行コマンド |
|---|---|
| データモデル | `npx vitest run src/db/__tests__/cooklog-schema.test.ts` |
| リポジトリ | `npx vitest run src/repo/cooklog/__tests__` |
| 業務ロジック | `npx vitest run src/domain/cooklog/__tests__` |
| API | `npx vitest run src/api/routes/__tests__/cooklog.test.ts` |
| 画面 | `npx vitest run src/ui/cooklog/__tests__` |
| U5 全体 | `npx vitest run src/db/__tests__/cooklog-schema.test.ts src/repo/cooklog/__tests__ src/domain/cooklog/__tests__ src/api/routes/__tests__/cooklog.test.ts src/ui/cooklog/__tests__` |

## 必ず入れるテスト

- 同じ料理に、別の日の記録を何件も追加できる。同じ料理の同じ日は、すでにあることが分かる。
- 未来の日付は追加できない（日本時間の今日まで）。
- 1 日に複数の料理を記録でき、カレンダーの集計に複数ある表示が出る。
- 最新の記録が「もう作りたくない」の料理は候補の後ろ。最新が「また作りたい」なら後ろにずれない。
- 他のグループの記録は読み書きできない。CSRF の欠落は拒否される。
