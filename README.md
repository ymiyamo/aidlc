# 献立の候補アプリ（U1 最小の通し版）

気になった料理の URL を保存して、買い物前に家族でスワイプして選ぶ、スマートフォン向けの Web アプリです。
これは「最小の通し版（walking skeleton）」で、次の流れが端から端まで動きます。

登録 → 家族グループの作成（定番の料理 30 件が最初から入る）→ 買い物前の候補をスワイプ／ボタンで見る → 「＋」で料理を保存 → お気に入り・編集・削除 → 「選んだもの」

技術：TypeScript、Node.js、Next.js（App Router）、PostgreSQL 互換、テストは Vitest、整形と lint は Prettier と ESLint。

## ローカルで動かす（Docker も外部 DB も要りません）

必要なもの：Node.js 20 以上（長期サポート版の 22 を推奨）と npm。

```bash
npm install
npm run dev
```

ブラウザで http://localhost:3000 を開きます（スマートフォンの縦向きの幅、360px くらいで見ると想定どおりの見た目です）。

1. 「新しく登録」でメールアドレスとパスワード（8 文字以上）を入れて登録します。メールは送りません。
2. 家族のグループ名（空なら「わが家」）を入れて作成します。定番の料理 30 件が入ります。
3. ホームの「買い物前」を押します。カードを右にスワイプ（またはボタン「これにする」）で選び、左にスワイプ（またはボタン「パス」）で次へ進みます。
4. 右下の「＋」から、URL と料理名だけで保存できます。詳しい情報（調理時間・手間・タグ・材料・メモ）は任意です。
5. 「保存」タブで一覧、お気に入り、編集、削除ができます。「選んだもの」タブで、選んだ料理を確認して外せます。

データは `.data/` に保存され、`npm run dev` を止めても残ります。

### データのリセット

```bash
npm run db:reset   # .data/ を削除します（登録したアカウントも料理も消えます）
```

手で `.data/` を削除しても同じです。

## コンテナの PostgreSQL を使う場合（任意）

`DATABASE_URL` を設定すると、組み込みの DB の代わりに PostgreSQL に接続します。

```bash
docker compose up -d                     # PostgreSQL 16 を起動（ローカル確認用の固定の値です）
cp .env.example .env.local               # DATABASE_URL の行のコメントを外す
npm run dev
```

`.env.local` の例：`DATABASE_URL=postgres://mealplanner:mealplanner@localhost:5432/mealplanner`

移行（`db/migrations/*.sql`）は起動時に自動で適用されます。手で適用するときは `npm run db:migrate` を使います。

## テストと品質の確認

```bash
npm test                      # すべてのテスト
npm run test:unit             # このユニットのテスト（db / repo / domain / api / ui）
npm run test:coverage         # カバレッジつき
npm run lint                  # ESLint
npm run typecheck             # 型の確認
npm run format:check          # Prettier の確認（整形は npm run format）
npm run build                 # 本番ビルド
```

層ごとに実行するとき：

```bash
npx vitest run src/db/__tests__/schema.test.ts   # データベースの制約
npx vitest run src/repo/__tests__                # データアクセス（グループの範囲）
npx vitest run src/domain/__tests__              # 業務ルール
npx vitest run src/api/__tests__                 # API（CSRF、認可、ログの伏せ字、通しの流れ）
npx vitest run src/ui/__tests__                  # 画面の動作
```

テストは外部の準備なしで動きます（テストファイルごとに空のメモリ上の PostgreSQL を作って移行を適用します）。

## 設定（環境変数）

`.env.example` を参照してください。実際の値は `.env.local` に書き、リポジトリには入れません。

| 名前            | 意味                                                                        |
| --------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`  | 空なら組み込みの DB（`.data/`）。設定すると PostgreSQL に接続               |
| `COOKIE_SECURE` | Cookie に Secure を付けるか。未指定は、本番（`NODE_ENV=production`）で true |
| `APP_ORIGIN`    | Origin の照合に使うこのアプリの URL（プロキシの後ろで動かすとき）           |
| `BCRYPT_COST`   | パスワード変換のコスト（既定 10）                                           |

注意：`npm run build` のあと `npm start` で動かすと `NODE_ENV=production` になり、Cookie に Secure が付きます。
http://localhost で確認するときは `COOKIE_SECURE=false` を付けてください（`npm run dev` は不要）。
本番モードで試すときは `APP_ORIGIN=http://localhost:3000` を設定する（未設定だと、本番では状態を変える操作がすべて拒否されます）。

## ディレクトリ

```
src/app/        画面（Next.js App Router）と /api の入口、/healthz
src/api/        API の入口（認証、グループの決定、CSRF、構造化ログ）
src/domain/     業務ルール（BR1〜BR4）
src/repo/       データアクセス（すべての問い合わせが householdId 必須）
src/db/         DB の接続（pg / PGlite の切り替え）と移行
src/ui/         画面の部品
db/migrations/  SQL の移行
data/           初期データ（seed-dishes.json、30 件。差し替えれば内容を入れ替えられる）
infra/          AWS CDK の構成コード（合成のみ。下記）
```

## AWS の構成コード（infra/）

`infra/` は AWS CDK（TypeScript）の骨組みです。**実際の作成（`cdk deploy`）は行いません。** 費用と取り消しにくさがあるため、利用者の別の承認を得てから行います。

```bash
cd infra
npm install
npx cdk synth --quiet     # 構成を組み立てて検証するだけ。AWS には接続しません
```

未完成の部分（アプリ本体の配置、検証環境の入口の制限、死活確認など）は、コード内の TODO に理由を書いています。

## 初期データ

`data/seed-dishes.json`（30 件、ダミーの URL）が、グループ作成のたびにそのグループの料理として複製されます。
差し替えるときは、30 件・`seedKey` の重複なし・各行が URL／文字数／タグ（5 個以内・20 文字以内）の決まりを満たす形にしてください。満たさないと「初期データを準備中です」と表示され、異常はログに記録されます。

## グループとアカウントの管理（U7）と、デモの手順

メールは実際には送りません。招待リンクとパスワード再設定リンクは、画面に表示します（開発・通し版の設定のときだけ。`NODE_ENV=production` では、再設定リンクの表示は無効です）。

### 招待リンクで家族を加える

1. 1 人目で登録し、グループを作る。ホームの「⚙ 家族の招待・設定」を開く。
2. 「招待リンクを作る」を押すと、リンクが表示される（7 日間、1 回だけ使える。この画面を閉じると再表示できない）。コピーする。
3. 別のブラウザ（またはシークレットウィンドウ）でそのリンクを開く。グループ名が表示される。
4. 「ログイン」か「新しく登録」で 2 人目のアカウントを作る（終わると参加の画面に戻る）。表示名を入れて「参加する」を押すと、同じ料理が見える。

### グループから抜ける

設定の「グループから抜ける」→ 確認で「抜ける」。保存した料理は残り、保存した人は「退会したメンバー」と表示される。最後の 1 人が抜けるときは、データがすべて消えることを示す 2 回目の確認が出る。

### パスワードの再設定

ログイン画面の「パスワードを忘れた方」→ メールアドレスを入れる → 画面に出る「パスワードを再設定する」のリンクを開き、新しいパスワードを入れる（60 分間、1 回だけ使える）。ログイン状態はすべて終わり、ロックも解ける。

### ログイン失敗の制限

パスワードを 5 回続けてまちがえると、そのアカウントは 15 分間ログインできません（正しいパスワードでも不可）。

### アカウントの削除

設定の「アカウントを削除する」→ パスワードを再入力し、確認のチェックを入れる。メールアドレスとパスワードが消える。

### 試験

```bash
npx vitest run src/db/__tests__/admin-schema.test.ts src/repo/admin/__tests__ src/domain/admin/__tests__ src/api/routes/__tests__/admin.test.ts src/ui/admin/__tests__
```

## 作った記録（U5）と、デモの手順

料理ごとに「作った日」を何回でも残し、感想（また作りたい／もう作りたくない）と注意点のメモを添えます。日付は日本時間で、今日までしか選べません。

1. 「保存」タブで料理を開く。「作った日」の欄で「作った日を追加」を押し、日付（初期値は今日）・感想・メモを入れて保存する。同じ料理を別の日に何回でも追加できる。同じ料理の同じ日は 1 件まで（すでにあると知らせ、その記録の編集に進める）。
2. 画面の URL に `/records` を開く（ホーム等からの導線は、統合のときに足す）。月のカレンダーに、作った日ごとに料理名と感想の印が出る。1 日に複数あると「ほか N 件」と出る。「一覧」で切り替え、「前の月」「次の月」で月を移れる。
3. カレンダーの日を押すと、その日の記録と「作ったものを追加」が出る（未来の日は押せない）。項目を選ぶ画面で、料理名の絞り込みと「最近選んだもの／お気に入り／すべて」を使い、見つからなければ「新しく保存する」へ進める。
4. 記録は「編集する」「削除する」（確認のあと、その 1 件だけ）で直せる。
5. 最新の記録が「もう作りたくない」の料理は、買い物前の候補で後ろに回る（最新が「また作りたい」なら回らない）。

```bash
npx vitest run src/db/__tests__/cooklog-schema.test.ts src/repo/cooklog/__tests__ src/domain/cooklog/__tests__ src/api/routes/__tests__/cooklog.test.ts src/ui/cooklog/__tests__
```

## 画像（U6）と、初期データの画像の入れ替え

料理には、利用者が登録した画像（5MB 以下の JPEG・PNG・WebP・GIF。中身で判定します）か、登録がなければ「AI が作ったイメージ」の印つきの画像が出ます。画像はグループの外には見えません（画像の取得も、そのたびにログインとグループを確認します）。

- **生成 AI は呼びません。** サービスが未決定のため、通し版は料理名から色を決めたダミーの絵（PNG）を、ローカルで作ります。差し替えるときは `src/domain/images/dummy.ts` の `ImageGeneratorPort` の実装だけを替えます（`setImageServices` で注入できます）。
- **画像の保管**：ローカルは `.data/images/`（`IMAGE_STORAGE_DIR` で変更。`.gitignore` 済み。`npm run db:reset` で一緒に消えます）。保管は `src/lib/storage` の抽象の後ろにあり、AWS の保管場所への差し替えは TODO です。
- **画像の登録 API**：`PUT /api/dishes/:id/image`（本文は `{"data": "<base64>"}`）。5MB 超は 413、画像でないものは 415。ほかに `GET`・`DELETE /api/dishes/:id/image`（状態・外す）、`POST /api/dishes/:id/image/generate`（AI の画像の要求）、`GET /api/dishes/:id/image/file`（実体）。
- **新しい料理に画像を付ける**：料理を先に保存し、そのあとで画像を登録します。画像が拒否されても料理は保存済みで、編集の画面から登録し直せます。

### 初期データの画像を入れ替える（プログラムは変えません）

初期データ 30 件の画像は、`data/seed-images/<seedKey>.png`（`.jpg`・`.jpeg`・`.webp`・`.gif` も可。`SEED_IMAGE_DIR` で置き場を変更）に置いたファイルを、全グループで共有して使います。

1. `data/seed-dishes.json` の `seedKey`（例：`nikujaga`）と同じ名前で、画像ファイルを `data/seed-images/` に置く（置き換える）。
2. 5MB 以下の JPEG・PNG・WebP・GIF にする。画像でない、または 5MB を超えるファイルは、その料理だけ色の枠になり、ログに `seed_image_invalid` が出ます（ほかの料理は止まりません）。
3. 新しいグループも既存のグループも、以後の表示で入れ替えた画像になります（読み取り専用で共有するため）。ファイルを置いていない料理は、ダミーの絵が出ます。

```bash
npx vitest run src/db/__tests__/images-schema.test.ts src/repo/images/__tests__ src/domain/images/__tests__ src/api/routes/__tests__/images.test.ts src/ui/images/__tests__
```
