# コード生成の概要：U7 グループとアカウントの管理（account-admin）

## 作ったもの
- 移行 `db/migrations/007_account_admin.sql`（招待、パスワード再設定、ログイン失敗の回数とロック解除時刻）
- リポジトリ `src/repo/admin/`、業務ロジック `src/domain/admin/`、API `src/api/routes/admin.ts`
- 画面 `src/ui/admin/`、ページ `src/app/{join,settings,password/forgot,password/reset}/`
- 既存の共有ファイルの変更：`src/api/router.ts`（`adminRoutes` の登録）、`src/domain/auth.ts`（ロック確認）、`src/domain/events.ts`、`src/repo/accounts.ts`、`src/app/page.tsx`、`src/ui/AuthForm.tsx`、`package.json`（`test:unit` を `vitest run src` にして全ユニットのテストを対象にした）、`README.md`

## 検証（実行して確認）
- `npm run typecheck && npm run lint && npm run test:unit`：13 ファイル、222 件すべて成功（U1 の 121 件は緑のまま、U7 は 101 件）。
- 行カバレッジの数値（80% 以上）はまだ測っていない。Build and Test で測る。

## 未検証・注意
- ブラウザでの見た目、360px 幅の横スクロールなしは、まだ目視していない。
- メールは送らず、再設定・招待のリンクを画面（開発用の送信箱）に出す代替。
- 追跡ファイルの対応先は、受け入れ基準を API、業務規則 BR50.x を `src/domain/admin/index.ts` と、モジュール単位の粗い対応にしている。
- 暫定の BR50.2（再設定の発行は 1 時間に 3 回まで）、BR50.19（削除の再入力は 5 回まちがえたら 15 分）は計画の承認で確認する扱い。
- AWS へのデプロイ・操作はしていない。
