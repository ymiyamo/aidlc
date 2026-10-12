# コード生成の概要：U6 画像（images）

## 作ったもの
- 移行 `db/migrations/006_images.sql`（登録画像、AI 画像の状態 pending／ready／failed）
- ファイル保管の抽象 `src/lib/storage/`（ローカルはディスク `.data/images/`、`.gitignore` 済み）
- リポジトリ `src/repo/images/`、業務ロジック `src/domain/images/`、API `src/api/routes/images.ts`
- 画面 `src/ui/images/`、`src/ui/DishCard.tsx` と `src/ui/DishForm.tsx` への最小の差し込み
- 既存の共有ファイルの変更：`src/api/router.ts`（`imagesRoutes` の登録）、`README.md`

## 検証（実行して確認）
- `npm run typecheck && npm run lint && npm run test:unit`：23 ファイル、367 件すべて成功（U6 は 70 件、既存 297 件は緑のまま）。
- 行カバレッジの数値（80% 以上）は未計測。Build and Test で測る。

## 未検証・注意
- ブラウザでの見た目、実ファイルのアップロード操作は目視していない（jsdom と API テストまで）。
- 生成 AI は呼ばない。画像のない料理には「AI が作ったイメージ」の印つきのダミー画像（色と料理名の頭文字）を出す。
- AWS の保管場所（S3 など）への差し替えは未実装（ポートのみ）。AWS へのデプロイ・操作はしていない。
- 追跡ファイルの対応先は、受け入れ基準を API、業務規則を `src/domain/images/index.ts` と、モジュール単位の粗い対応。
