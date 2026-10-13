# テスト結果

実行日: 2026-10-12（ローカル、macOS、AWS操作なし）

## 実行結果一覧

| 区分 | コマンド | 結果 |
|---|---|---|
| 型検査 | `npm run typecheck` | 成功、終了コード 0 |
| lint | `npm run lint` | 成功、終了コード 0 |
| 承認済み検証 | `npm run typecheck && npm run lint && npm run test:unit` | 成功、43 files / 719 tests passed |
| 標準全テスト | `npm test` | 成功、43 files / 719 tests passed、failed 0、skipped 0 |
| coverage | `npm run test:coverage` | 成功、43 files / 719 tests passed |
| 本番ビルド | `npm run build` | 成功、Next.js 15.5.27 の build 完了 |
| 整形検査 | `npm run format:check` | 成功、全ファイルが Prettier 準拠 |
| DB/repository/API統合相当 | `npx vitest run src/db/__tests__ src/repo src/api/routes/__tests__` | 成功、20 files / 250 tests passed |
| セキュリティ相当 | `npx vitest run src/api/__tests__ src/api/routes/__tests__ src/domain/admin/__tests__ src/domain/images/__tests__` | 成功、10 files / 178 tests passed |
| ローカル起動スモーク | `npm start` + `curl ... http://localhost:3000/healthz` | 成功、`HTTP/1.1 200 OK` |

## ユニット別結果

| Unit | test files | tests | 結果 |
|---|---:|---:|---|
| U1 skeleton | 9 | 124 | passed |
| U2 taste-filter | 6 | 142 | passed |
| U3 shopping-list | 6 | 90 | passed |
| U4 meal-plan | 6 | 111 | passed |
| U5 cook-log | 5 | 75 | passed |
| U6 images | 5 | 73 | passed |
| U7 account-admin | 5 | 101 | passed |
| 合計（重複なし） | 43 | 719 | passed |

各ユニットのコマンドは `integration-test-instructions.md` に完全な形で記載した。U4 は `mealplan-schema.test.ts` で `008_meal_plan_integrity.sql` の7日連続制約・複合 FK・fail-closed を確認した。

## Coverage

`vitest.config.ts` の v8 coverage 設定で実測した結果は次のとおり。

| 指標 | 実測 |
|---|---:|
| Statements | 98.68% (1204/1220) |
| Branches | 93.98% (328/349) |
| Functions | 94.56% (87/92) |
| Lines | 98.68% (1204/1220) |

設定された変更共有経路の最小 Lines は `src/domain/suggestion.ts` の 93.85% であり、設定閾値 Lines 80% を上回った。これは coverage.include に指定された範囲の測定であり、リポジトリ全体の無条件な coverage を意味しない。U1 walking skeleton 自体にはチーム方針により80%下限を適用しない。

## 修正後の再検証と残存事項

1. `npx prettier --write presentation/index.html presentation/style.css` を実行し、`npm run format:check` は全ファイル一致、終了コード 0 になった。
2. U7 の `traceability.json` に `AC7.3.1`、`AC7.3.2`、`AC7.4.1`、`AC7.4.2`、`AC7.5.1` を追加した。JSON妥当性、全AC 107件、対象ファイル存在を機械検査し、欠落は0件になった。
3. 性能の p95、4G相当の画面表示、コールドスタート、実ブラウザ、AWS HTTPS/HSTS/監視、SAST/DAST、外部脆弱性照合は実施していない。数値を推測せず `Unverified` とした。

## 失敗テストの詳細

失敗したテストケース、failed assertion、stack trace はない。修正後のテスト実行は全719件成功した。残存する `Unverified` は性能、実ブラウザ、AWS固有項目である。

## 最終判定

- Build: **Met**
- Unit/integration/security test execution: **Met**
- Coverage target: **Met**
- Formatting gate: **Met**
- Cross-unit traceability completeness: **Met**（AC 107件中107件を追跡）
- Performance/browser/infrastructure targets: **Unverified**
- Build and Test stage overall: **Not ready / 未完了**。コードのビルド、テスト、整形、追跡は緑だが、性能・実ブラウザ・AWS固有ターゲットが未検証である。
