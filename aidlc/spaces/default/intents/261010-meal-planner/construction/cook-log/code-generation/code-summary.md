# コード生成の概要：U5 作った記録（cook-log）

## 作ったもの
- 移行 `db/migrations/005_cook_log.sql`（CookRecord。同じ料理の同じ日は 1 件までの一意制約）
- リポジトリ `src/repo/cooklog/`、業務ロジック `src/domain/cooklog/`、API `src/api/routes/cooklog.ts`
- 画面 `src/ui/cooklog/`、ページ `src/app/records/`（一覧／カレンダー、追加・編集・削除）、料理詳細の「作った日」欄
- 既存の共有ファイルの変更：`src/api/router.ts`（`cooklogRoutes` の登録）、`src/domain/suggestion.ts`（「もう作りたくない」を後ろへ並べる拡張点）、`src/app/dishes/[id]/page.tsx`、`README.md`

## 検証（実行して確認）
- `npm run typecheck && npm run lint && npm run test:unit`：18 ファイル、297 件すべて成功（U5 は 75 件、既存 222 件は緑のまま）。
- 行カバレッジの数値（80% 以上）は未計測。Build and Test で測る。

## 未検証・注意
- ブラウザでの見た目、360px 幅の横スクロールなしは目視していない（jsdom のテストまで）。
- ホームなどからの導線は未接続。デモでは `/records` を直接開く（料理詳細からはリンクあり）。
- BR40.18（保存後に同じ日付の選択画面へ戻る）は `sessionStorage` で `/records` を開いたときに復元する形で、自動では戻らない。
- 「最近選んだもの」は `/api/picked` の料理という解釈。
- エラーコード `FUTURE_DATE_NOT_ALLOWED`・`DUPLICATE_RECORD` は応答の `error.code` を上書きして返す（HTTP 400 / 409）。
- 追跡ファイルの対応先は、受け入れ基準を API、業務規則を `src/domain/cooklog/index.ts` と、モジュール単位の粗い対応。
- AWS へのデプロイ・操作はしていない。
