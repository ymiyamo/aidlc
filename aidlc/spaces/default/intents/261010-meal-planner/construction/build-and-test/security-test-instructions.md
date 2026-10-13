# セキュリティテスト手順

## 対象

NFR3.1〜NFR3.6、U1-NFR3.1〜U1-NFR3.15、および U7 の招待、ログイン失敗制限、パスワード再設定、アカウント削除を対象にする。認証・認可、CSRF、入力検証、household 分離、秘密情報のログ出力抑制、画像の内容判定とサイズ上限を中心に確認する。

## 実行コマンド

```bash
npx vitest run src/api/__tests__ src/api/routes/__tests__ src/domain/admin/__tests__ src/domain/images/__tests__
npm run typecheck
npm run lint
```

実測結果は、セキュリティ相当テストが 10 files / 178 tests passed、型検査成功、ESLint 成功である。全体の `npm run test:unit` も 43 files / 719 tests passed である。

## 確認した観点

- Origin または CSRF token がない状態変更を拒否する。
- 未ログイン、household 未所属、別 household の ID、削除済み対象を fail-closed に扱う。
- パスワードはハッシュ化され、ログイン失敗5回後の15分ロックと解除を確認する。
- 招待リンクは期限・使用済み・同時使用を制限し、トークンの平文を保存・ログ出力しない。
- パスワード、メールアドレス、Cookie、session、token、CSRF、memo、URL 等のログ伏せ字を確認する。
- URL は `http`/`https` のみ、入力の型・長さ・選択肢をサーバー側で検証する。
- 画像は中身で形式を確認し、5MB 以下を許可し、5MB 超・偽装・空データを拒否する。画像取得時も household を確認する。
- U4 の複合 FK と7日連続制約を DB テストで確認する。

## 未実施の確認

- SAST、DAST、依存パッケージの CVE データベース照合は、今回の環境に専用ツールがなく、外部サービス操作も禁止されているため実行していない。`npm audit` も外部レジストリへの照会になるため実行していない。
- AWS の HTTPS、HSTS、検証環境入口の制限、Secrets Manager、ネットワーク境界、CDK deploy 後の設定は確認していない。`cdk deploy` は実行しない。
- 実ブラウザでの XSS、Cookie 属性、CSP、クリックジャッキングの動的確認は未実施である。

## 判定

ローカルのアプリコード、DB、API境界についてはテスト実測を `Met` とする。一方、HTTPS、インフラ境界、SAST/DAST、依存脆弱性照合、実ブラウザ確認は `Unverified` とする。未実施の検査を合格扱いにしない。
