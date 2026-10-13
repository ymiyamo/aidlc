# 統合テスト手順

## 目的と方針

テスト戦略は Standard、手法は test-after である。単体テストだけでなく、PGlite 上の実 DB 移行、repository、domain、API の `handle()`、画面をつないだ境界を検証する。外部 PostgreSQL、Docker、AWS、外部 API は使わない。

Vitest の設定は `vitest.config.ts`、テスト環境は標準では Node.js、画面テストはテストファイル側の設定に従う。各テストファイルは独立した PGlite と移行を使うため、共有 DB の状態に依存しない。

## ユニット別コマンド

| Unit | コマンド | 実測結果 |
|---|---|---|
| U1 skeleton | `npx vitest run src/db/__tests__/schema.test.ts src/repo/__tests__ src/domain/__tests__ src/api/__tests__ src/ui/__tests__` | 9 files / 124 tests passed |
| U2 taste-filter | `npx vitest run src/db/__tests__/taste-schema.test.ts src/repo/taste/__tests__ src/domain/taste/__tests__ src/api/routes/__tests__/taste.test.ts src/ui/taste/__tests__` | 6 files / 142 tests passed |
| U3 shopping-list | `npx vitest run src/db/__tests__/shopping-schema.test.ts src/repo/shopping/__tests__ src/domain/shopping/__tests__ src/api/routes/__tests__/shopping.test.ts src/ui/shopping/__tests__` | 6 files / 90 tests passed |
| U4 meal-plan | `npx vitest run src/db/__tests__/mealplan-schema.test.ts src/repo/mealplan/__tests__ src/domain/mealplan/__tests__ src/api/routes/__tests__/mealplan.test.ts src/ui/mealplan/__tests__` | 6 files / 111 tests passed |
| U5 cook-log | `npx vitest run src/db/__tests__/cooklog-schema.test.ts src/repo/cooklog/__tests__ src/domain/cooklog/__tests__ src/api/routes/__tests__/cooklog.test.ts src/ui/cooklog/__tests__` | 5 files / 75 tests passed |
| U6 images | `npx vitest run src/db/__tests__/images-schema.test.ts src/repo/images/__tests__ src/domain/images/__tests__ src/api/routes/__tests__/images.test.ts src/ui/images/__tests__` | 5 files / 73 tests passed |
| U7 account-admin | `npx vitest run src/db/__tests__/admin-schema.test.ts src/repo/admin/__tests__ src/domain/admin/__tests__ src/api/routes/__tests__/admin.test.ts src/ui/admin/__tests__` | 5 files / 101 tests passed |

## 横断的な統合確認

```bash
npm run test:unit
npm test
```

両方とも 43 test files / 719 tests passed、failed 0、skipped 0 である。`npm run test:unit` は `package.json` の `vitest run src`、`npm test` は `vitest run` であり、いずれも Vitest の include 設定により全テストを対象にする。

DB と API 境界を重点的に確認する追加コマンドは次のとおり。

```bash
npx vitest run src/db/__tests__ src/repo src/api/routes/__tests__
```

実測は 20 files / 250 tests passed である。U4 の `mealplan-schema.test.ts` には `008_meal_plan_integrity.sql` の7日連続制約、複合 FK、異なる household の fail-closed 検証が含まれる。

## 統合境界の確認項目

- `src/api/router.ts` の `handle()` 経由で、認証、household の決定、CSRF、ルート、DB を一連で検証する。
- household ID や member ID を本文から受け取らず、入口で決まった所属だけを使う。
- 異なる household の料理、献立、買い物リスト、記録、画像は読み書きとも見えないことを確認する。
- U2 の除外条件が U1 の候補取得に反映され、U3 の買い物リストが U4 の `composeFromIngredients` と接続する。
- U5 の最新評価による並び替え、U6 の画像境界、U7 のイベントと認証管理を既存候補経路と一緒に確認する。
- テストデータは各テストで作成し、個人情報・本番データを使用しない。

## 合否

テストコマンドの合否は終了コード 0、全テスト passed、failed 0、skipped 0 とする。ただし、Build and Test 全体の合否は、別途 `build-and-test-summary.md` のターゲット行列と `cross-unit-traceability.md` を合わせて判定する。性能、実ブラウザ、AWS 固有の検証はこのローカル統合テストの合格をもって代替しない。
