# ビルド手順

## 前提

- Node.js 20 以上（`package.json` の `engines.node`）
- npm と、リポジトリに固定された `package-lock.json`
- 外部 PostgreSQL は必須ではない。`DATABASE_URL` 未設定時は PGlite を `.data/` に使用する。
- `DATABASE_URL` を使う場合だけ、接続先を環境変数で設定する。秘密値は `.env.local` に置き、コミットしない。
- AWS、Docker 上の外部サービス、外部 API はこの検証では使用しない。

## 依存関係と環境

```bash
npm install
npm ls --depth=0
```

`npm install` は `package-lock.json` に従って依存関係を復元する。今回の Build and Test では既存の `node_modules` を使用し、`npm ls --depth=0` が成功したことを確認した。

必要に応じて次の環境変数を設定する。

```bash
# ローカルの組み込み DB を使う場合は不要
DATABASE_URL=postgres://...
COOKIE_SECURE=false
APP_ORIGIN=http://localhost:3000
BCRYPT_COST=10
```

DB 移行を手動で確認する場合は次を実行する。

```bash
npm run db:migrate
```

テストはテストファイルごとに PGlite を初期化し、`db/migrations/*.sql` を適用するため、通常は外部 DB の起動は不要である。

## ビルドと品質検査

承認済みの検証コマンドは次のとおり。

```bash
npm run typecheck && npm run lint && npm run test:unit
```

追加のビルド・品質確認は次の順で実行する。

```bash
npm run build
npm run test
npm run test:coverage
npm run format:check
```

- `npm run typecheck`: TypeScript の型検査。
- `npm run lint`: ESLint 検査。`aidlc/`、`.next/`、`infra/` などは設定で除外される。
- `npm run test:unit`: `src` 配下の全 Vitest テスト。
- `npm run build`: Next.js の本番バンドル、型検査、ページ生成。
- `npm run test:coverage`: Vitest + v8 coverage。`vitest.config.ts` の `coverage.include` と Lines 80% 閾値を使用する。
- `npm run format:check`: Prettier 検査。CI 品質ゲートに含める場合は失敗を解消する。

## ビルド検証

本番ビルド後のローカル起動確認は次のとおり。

```bash
npm start
curl --fail --silent --show-error --max-time 10 -D - http://localhost:3000/healthz -o /tmp/meal-planner-healthz.body
```

期待値は `HTTP/1.1 200 OK` である。確認後は起動プロセスを停止する。今回この確認は実施済みで、`healthz` は 200 を返した。

## トラブルシューティング

- `Cannot find module` や lockfile 不一致: `node_modules` を削除せず、まず `npm install` を再実行し、Node.js の版を確認する。
- PGlite の起動タイムアウト: `vitest.config.ts` の `testTimeout: 30000` と `hookTimeout: 60000` を確認し、同時実行プロセスがない状態で再実行する。
- `DATABASE_URL` による接続失敗: ローカル検証では環境変数を外して PGlite を使い、PostgreSQL を使う場合だけ接続先を確認する。
- `npm run format:check` の失敗: 出力されたファイルだけを確認し、意図した修正を人が承認してから `npm run format` または対象ファイルの限定修正を行う。今回の初回失敗では `presentation/index.html` と `presentation/style.css` を限定整形し、再検証で成功した。
- `npm run build` の失敗: `next.config.mjs`、環境変数、`.next/` の生成状態を確認し、AWS 操作で解決しない。
