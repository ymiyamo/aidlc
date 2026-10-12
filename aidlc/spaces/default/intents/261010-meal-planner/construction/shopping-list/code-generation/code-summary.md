# コード生成の概要：U3 買い物リスト（shopping-list）

## 作ったもの
- 移行 `db/migrations/003_shopping.sql`（買い物リストと行。作成中の picked のリストはグループにつき 1 件まで）
- リポジトリ `src/repo/shopping/`、業務ロジック `src/domain/shopping/`（合算・同期・完了、献立から受け取る `composeFromIngredients`）、API `src/api/routes/shopping.ts`
- 画面 `src/ui/shopping/`、ページ `src/app/shopping/`、ホームと「選んだもの」画面からの導線
- 既存の共有ファイルの変更：`src/api/router.ts`（`shoppingRoutes` の登録）、`src/app/page.tsx`、`src/app/picked/page.tsx`、`README.md`

## 検証（実行して確認）
- `npm run typecheck && npm run lint && npm run test:unit`：37 ファイル、608 件すべて成功（U3 は 90 件、既存 518 件は緑のまま）。
- 行カバレッジの数値（80% 以上）は未計測。Build and Test で測る。

## 未検証・注意
- ブラウザでの見た目、360px 幅の横スクロールなしは目視していない（jsdom と API テストまで）。
- 暫定：分量 0 は数として扱わず料理ごとの別の行、小数は第 2 位まで四捨五入（承認で確認する扱い）。
- 追跡ファイルの対応先は、受け入れ基準を API、業務規則を `src/domain/shopping/index.ts` と、モジュール単位の粗い対応。
- AWS へのデプロイ・操作はしていない。
