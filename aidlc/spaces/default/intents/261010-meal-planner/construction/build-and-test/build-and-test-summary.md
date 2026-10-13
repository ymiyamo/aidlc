# Build and Test サマリー

## 総合判定

**コードのビルド・テスト・整形・追跡は成功。ただし、Build and Test 品質ゲートは Not ready。**

`npm run typecheck && npm run lint && npm run test:unit`、`npm test`、`npm run build`、`npm run format:check`、coverage、統合相当テスト、セキュリティ相当テストは成功した。U7 traceability の5件を追加し、AC 107件の欠落は0件になった。性能、実ブラウザ、AWS/本番固有のターゲットは測定できず `Unverified` である。未検証を理由にターゲットを緩和していない。

## 前提と実測

- Node.js 20 以上、TypeScript、Next.js 15.5.27、PGlite、Vitest 3.2.7。
- 全43 test files、719 tests。failed 0、skipped 0。
- 本番ビルド成功。ローカル `healthz` は `HTTP/1.1 200 OK`。
- coverage: Statements 98.68%、Branches 93.98%、Functions 94.56%、Lines 98.68%。Lines の設定閾値80%を通過。
- AWS deploy、Docker 外部 DB、外部 API、外部脆弱性サービスは使用していない。

## Target Verification Matrix

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| NFR1.1 | `requirements.md` | 360px縦向き・横スクロールなし | 実ブラウザ未確認 | jsdom/UI tests only | Build and Test | Unverified |
| NFR1.2 | `requirements.md` | ホームから買い物前まで2操作以内 | 操作経路テストはあるが実端末未確認 | `npm test` | Build and Test | Unverified |
| NFR1.3 | `requirements.md` | 保存を1画面で完了 | UIテストで確認 | `src/ui/__tests__`, build | Build and Test | Met |
| NFR1.4 | `requirements.md` | コントラスト4.5:1・適切なラベル | ラベルテストは通過、コントラスト実測なし | UI tests / CSS | Build and Test | Unverified |
| NFR1.5 | `requirements.md` | スワイプ相当をボタンでも操作可能 | テスト成功 | `npm test` | Build and Test | Met |
| NFR1.6 | NFR requirements | iPhone Safari/Android Chrome/desktop対応 | 実ブラウザ未確認 | なし | Build and Test | Unverified |
| NFR2.1 | `requirements.md` | 200件以下の候補・絞り込み | p95未測定 | performance instructions | Build and Test | Unverified |
| NFR2.2 | `requirements.md` | 献立提案3秒以内 | p95未測定 | performance instructions | Build and Test | Unverified |
| NFR2.3 | `requirements.md` | 買い物リスト1秒以内 | p95未測定 | performance instructions | Build and Test | Unverified |
| NFR3.1 | `requirements.md` | ハッシュ化、5回失敗で15分ロック | テスト成功 | U7 tests / security tests | Build and Test | Met |
| NFR3.2 | `requirements.md` | household外の閲覧・変更不可 | テスト成功 | DB/API tests | Build and Test | Met |
| NFR3.3 | `requirements.md` | HTTPS | ローカルHTTPのみ。AWS未実施 | healthz smoke | Build and Test | Unverified |
| NFR3.5 | `requirements.md` | 入力検証、http/https URL | テスト成功 | API/domain tests | Build and Test | Met |
| NFR3.6 | `requirements.md` | 画像形式・5MB以下 | 5MB境界・偽装をテスト成功 | U6 tests | Build and Test | Met |
| NFR4.1 | `requirements.md` | 再ログイン後もデータ保持 | DB/repository/APIテスト成功 | 719 tests | Build and Test | Met |
| NFR4.2 | `requirements.md` | 中途半端な状態を残さない | 取引・境界テスト成功 | DB/domain tests | Build and Test | Met |
| NFR4.3 | `requirements.md` | バックアップ方針 | 本プロジェクトはバックアップを取らない決定 | reliability requirements | Build and Test | N/A |
| NFR4.6 | `requirements.md` | 停止・エラー増加の通知 | healthz応答のみ。通知設定未確認 | local smoke / infra TODO | Build and Test | Unverified |
| NFR5.1 | `requirements.md` | 外部データを自動取得しない | 外部呼出しなしの実装・テスト | code/tests | Build and Test | Met |
| NFR5.2 | `requirements.md` | 外部停止時も主要機能利用可能 | 外部依存を使わない構成は確認、障害試験なし | code/tests | Build and Test | Unverified |
| NFR6.1 | `requirements.md` | 追加コード Lines 80%以上、CI実行 | Lines 98.68%、CI実行は未確認 | `npm run test:coverage` | Build and Test | Unverified |
| NFR6.2 | `requirements.md` | format/lint、CI失敗時はマージ不可 | lint成功、Prettier全ファイル一致 | `npm run lint`, `npm run format:check` | Build and Test | Met |
| NFR6.3 | `requirements.md` | walking skeleton通し確認 | API一連テスト成功 | `src/api/__tests__` / `npm test` | Build and Test | Met |
| NFR6.4 | `requirements.md` | group境界・同時一意性 | テスト成功 | U1 DB/API tests | Build and Test | Met |
| NFR7.4〜7.8 | scalability requirements | DB制約・状態なし・競合安全 | 関連テスト成功 | DB/repo/domain tests | Build and Test | Met |
| NFR7.9 | scalability requirements | DB接続枯渇を防ぐ | AWS接続方式未検証 | infrastructure not deployed | Build and Test | Unverified |
| NFR7.10 | `requirements.md` | merge時staging自動、本番手動承認 | CI設定は確認したがデプロイ未実施 | `.github/workflows/ci.yml` | Build and Test | Unverified |
| Traceability | `stories.md` + 7 traceability JSON | AC 107件を全件追跡 | 107件中107件、欠落0件。対象ファイル欠落0件 | `cross-unit-traceability.md` | Build and Test | Met |

### N/A とした範囲

バックアップを実装しないという承認済み方針により NFR4.3 は N/A とした。可用性の数値目標を置かない方針も同様に、数値測定対象には含めていない。その他の適用可能な性能、ブラウザ、CI、インフラ項目は N/A にせず `Unverified` とした。

## 生成したテスト種別

- Build: typecheck、ESLint、Next.js production build。
- Unit/DB: 7ユニットの domain/repository/schema。
- Integration相当: PGlite + migrations + repository/domain/API `handle()`。
- UI: Testing Library/jsdom。
- Coverage: v8。
- Security相当: CSRF、Origin、認証認可、household分離、ログ伏せ字、入力・画像境界。
- Performance: 実行手順のみ。負荷試験は未実施。
- E2E/実ブラウザ/SAST/DAST: 未実施。

## 残存 Minor の扱い

- U5 イベント受け口の遅延登録、U6 アップロード境界・同時登録、U3 時計差・DB複合FK・桁上限、U4 同時更新境界・ブラウザ未確認は、レビューで Minor とされている。今回のテストで該当する DB/API/画像境界は確認できたが、時計差・高負荷同時更新・実ブラウザは未検証である。
- Minor は黙って解消済みとはせず、リリース前の追加確認または別タスクとして残す。特に実ブラウザと性能は、AWS操作禁止のため今回のゲートでは `Unverified` のままとする。

## Readiness

- **Build-ready:** Yes（build成功）。
- **Test-execution-ready:** Yes（719件成功）。
- **Quality-gate-ready:** No（性能・実ブラウザ・AWS固有の未検証ターゲットあり）。
- **Deployment-ready:** No（AWS操作、性能、実ブラウザ、HTTPS/HSTS、CI/CDデプロイ実証を行っていない）。

詳細は `test-results.md`、`performance-test-instructions.md`、`security-test-instructions.md`、`cross-unit-traceability.md` を参照する。
