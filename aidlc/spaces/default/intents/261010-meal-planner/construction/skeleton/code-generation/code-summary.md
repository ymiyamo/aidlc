# コード生成の要約：U1 最小の通し版（skeleton）

## 作ったもの

登録・ログイン、家族グループの作成と初期データ 30 件、料理の保存・編集・削除・お気に入り、買い物前の候補（スワイプ／ボタン）と「選んだもの」。スマートフォン向けの Web アプリ（Next.js + TypeScript）。ローカルでは `npm run dev` で、DB のインストールなしに動く（`DATABASE_URL` がなければ組み込みの PostgreSQL（PGlite）を `.data/` に保存して使う）。

## 層ごとの構成

| 層 | 場所 | 内容 |
|---|---|---|
| データモデル | `db/migrations/001_init.sql` | 表と一意制約（メール、有効な Member、PickedItem、seedKey） |
| データアクセス | `src/repo/`、`src/db/` | householdId を必須引数にした問い合わせ。pg／PGlite の切り替え |
| 業務ロジック | `src/domain/` | BR1〜BR4、初期データの冪等な登録、アプリ内の出来事（household.created） |
| API | `src/api/`、`src/app/api/`、`src/app/healthz/` | 入口で認証・グループの決定・CSRF・構造化ログ |
| 画面 | `src/ui/`、`src/app/` | 360px 幅向けの画面。`data-testid` とラベル付き |
| 環境 | `docker-compose.yml`、`.github/workflows/ci.yml`、`infra/` | コンテナの DB、確認用の流れ、CDK の骨組み（合成のみ） |

## テスト（test-after。層ごとに実装→テスト）

| 層 | ファイル | 件数 |
|---|---|---|
| データモデル | `src/db/__tests__/schema.test.ts` | 13 |
| リポジトリ | `src/repo/__tests__/repo.test.ts` | 13 |
| 業務ロジック | `src/domain/__tests__/*.test.ts`（3 ファイル） | 48 |
| API | `src/api/__tests__/api.test.ts` | 22 |
| 画面 | `src/ui/__tests__/*.test.tsx`（2 ファイル） | 21 |
| 合計 | 8 ファイル | 117 |

## 確認した結果（オーケストレーターが実行して確認したもの）

- テスト 117 件がすべて成功（`npx vitest run src/db/__tests__ src/repo/__tests__ src/domain/__tests__ src/api/__tests__ src/ui/__tests__`）。
- `npm run lint`、`npm run typecheck`、`npm run build` が成功。
- 開発エージェントの報告では、カバレッジは行 83.72%、分岐 89.55%、関数 86.39%（`src/app/` の薄いページ、テスト用の補助を除く）。この数値は私は再計測していない。通し版そのものには下限を適用しない（`team.md`）。
- 開発エージェントの報告では、`cdk synth` が通る。私は再実行していない。

## 計画と違う点・未完の点

- `infra/`：`cdk synth` は通る骨組みで、次は TODO（AWS には作っていない。作る前の承認までに完成させる）。
  - アプリ本体の関数への配置、検証環境の Basic 認証、API の直接アクセスの封じ（`X-Origin-Verify`）、HSTS とセキュリティヘッダー、死活確認、エラー率の割合アラーム、Secrets Manager から接続情報を組み立てる処理。
  - 検証環境への自動デプロイと、本番の手動承認の流れ（`ci.yml` は確認のみで、デプロイは書いていない。NFR7.10）。
  - 関数の環境変数に `APP_ORIGIN`（配信網のドメイン）を渡す処理。AWS では配信網が `Host` を変えて転送するため、Origin の照合の基準を明示する必要がある（レビュー指摘。コード側は、本番で `APP_ORIGIN` が未設定なら状態を変える操作を拒否するよう直す）。
  - 秘密の見出しの値に、仮の値（`TODO-change-me-before-deploy`）が入っている。配る前に必ず変える。
- 他のアプリの共有メニューから受け取る機能（BR3.14 の 3 つ目）は未対応（対応環境のみとされているため）。`/dishes/new?url=` で URL を受け取る口は用意した。
- 実ブラウザでの目視確認は、開発エージェントは未実施（API は curl、画面は jsdom のテストで確認）。
- 性能の測定（応答時間、2 秒、立ち上がりの遅れ）と、対応ブラウザの確認は未実施。Build and Test で行う（`traceability.json` に Deferred で記録）。
- 開発エージェントが、`docs/code-generation/` にも同名の要約を作ったが、正しい場所（この記録先）に作り直したので削除した。
