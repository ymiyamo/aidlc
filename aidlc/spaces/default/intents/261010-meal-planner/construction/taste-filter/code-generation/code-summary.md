# コード生成の概要：U2 好き嫌いと絞り込み（taste-filter）

## 作ったもの
- 移行 `db/migrations/002_taste.sql`（嫌いな食材。同じメンバーの同じ食材は 1 件まで）
- リポジトリ `src/repo/taste/`、業務ロジック `src/domain/taste/`、API `src/api/routes/taste.ts`
- 画面 `src/ui/taste/`、ページ `src/app/taste/`、「買い物前」画面への「今日の気分」シートの差し込み
- 既存の共有ファイルの変更：`src/api/router.ts`（`tasteRoutes` の登録と候補取得の絞り込み条件）、`src/domain/suggestion.ts`、`src/repo/dishes.ts`、`src/app/suggest/page.tsx`、`src/ui/SuggestionDeck.tsx`、`README.md`
- 契約文書 `inception/contract-design/contract-summary.md` の C1/C2 を `over30`／`cookTime` に修正

## 検証（実行して確認）
- `npm run typecheck && npm run lint && npm run test:unit`：31 ファイル、518 件すべて成功（U2 は 142 件、既存 376 件は緑のまま）。
- 行カバレッジの数値（80% 以上）は未計測。Build and Test で測る。

## 未検証・注意
- ブラウザでの見た目、360px 幅の横スクロールなしは目視していない（jsdom と API テストまで）。
- 食材名は文字列一致のみ（「えび」と「海老」は別）。アレルギー対応や表記ゆれの正規化はしない。
- 追跡ファイルの対応先は、受け入れ基準を API、業務規則を `src/domain/taste/index.ts` と、モジュール単位の粗い対応。
- AWS へのデプロイ・操作はしていない。
