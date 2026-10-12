# 単体テストの手順：U3 shopping-list

## 方針

- 標準の戦略（コンポーネントあたり 5〜8 件の単体テスト＋主要な境界の統合テスト）。手法は test-after。通し版の後の変更なので、行カバレッジ 80% 以上を目標にする（`team.md`）。
- U1 の Vitest の設定とテスト用の補助（PGlite のメモリ上のデータベース）をそのまま使う。

## このユニットだけのテストの実行コマンド

| 層 | 実行コマンド |
|---|---|
| データモデル | `npx vitest run src/db/__tests__/shopping-schema.test.ts` |
| リポジトリ | `npx vitest run src/repo/shopping/__tests__` |
| 業務ロジック | `npx vitest run src/domain/shopping/__tests__` |
| API | `npx vitest run src/api/routes/__tests__/shopping.test.ts` |
| 画面 | `npx vitest run src/ui/shopping/__tests__` |
| U3 全体 | `npx vitest run src/db/__tests__/shopping-schema.test.ts src/repo/shopping/__tests__ src/domain/shopping/__tests__ src/api/routes/__tests__/shopping.test.ts src/ui/shopping/__tests__` |

## 必ず入れるテスト

- 玉ねぎ 2 個と 1 個は「玉ねぎ 3 個」の 1 行（2 つの料理の名前つき）。玉ねぎ 2 個と 200 g は別の行。
- 「塩 少々」は料理ごとに別の行。分量が空の「醤油」も料理ごとの行。
- 材料が 0 行の料理は「材料の入力が必要」の行になり、チェックできない。
- 選んだものが 0 件のとき、空のリストの案内が出る。
- チェックは保存され、別のメンバーが開いても残る。同じ行は同期後もチェックを引き継ぎ、分量が変わった行はチェックが外れる。
- 「買い物おわり」でリストが完了になり、リストの料理の「選んだもの」が外れる。外し残しは次回にやり直され、完了後に選び直したものは外さない。完了後は新しい作成中のリストが始まる。
- 献立から渡された材料でリストができ、「選んだもの」のリストには触れない。
- 他のグループのリストは読み書きできない。CSRF の欠落は拒否される。
