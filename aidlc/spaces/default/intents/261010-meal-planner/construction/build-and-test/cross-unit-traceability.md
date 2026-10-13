# ユニット横断トレーサビリティ

## 検査方法

入力は次の成果物である。

- `inception/requirements-analysis/requirements.md`
- `inception/user-stories/stories.md`
- `construction/{skeleton,taste-filter,shopping-list,meal-plan,cook-log,images,account-admin}/code-generation/traceability.json`
- 各ユニットの `code-summary.md` と `unit-test-instructions.md`

7個の `traceability.json` を機械的に読み込み、ACを抽出し、対象ファイルの存在も確認した。修正後の結果は、AC 107件、traceability 行237件、ユニークID 227件、ステータス内訳 `OK 209 / Deferred 20 / N/A 8` である。実装対象パスとして記録された target はすべて存在した。

## FR/NFRの担当範囲

requirements.md から抽出した要求の担当を、ユニット横断の観点で整理する。トップレベル要件と、その配下の詳細要件は次のとおりである。

| 要件 | 主な担当Unit | 検証・備考 |
|---|---|---|
| FR1 / FR1.1〜FR1.9 | U1、U6 | 保存、候補、画像。AC1.x と AC1.5.x |
| FR2 / FR2.1〜FR2.9 | U1、U2 | 候補、絞り込み、除外、おまかせ。AC2.x |
| FR3 / FR3.1〜FR3.5 | U3 | 材料集計、チェック。AC3.x |
| FR4 / FR4.1〜FR4.3 | U2 | 好き嫌いの文字列一致。アレルギー・正規化は対象外。AC4.x |
| FR5 / FR5.1〜FR5.9 | U4 | 7日献立、やり直し、skip、買い物リスト。AC5.x |
| FR6 / FR6.1〜FR6.9 | U5 | 記録、カレンダー、並び替え。AC6.x |
| FR7 / FR7.1〜FR7.6 | U1、U7 | 認証、招待、脱退、削除、再設定。AC7.x |
| FR12 / FR12.1〜FR12.6 | U1、U6 | 初期30件、差し替え可能な画像。AC9.x |
| FR8〜FR11、FR13 | 対象外（Won't/次版） | 要件で明示された次版以降。今回の欠落ではない |
| NFR1 / NFR1.1〜NFR1.5 | 全UI Unit | 実ブラウザ・コントラストの一部は未検証 |
| NFR2 / NFR2.1〜NFR2.3 | U1〜U7の共有経路 | p95・画面時間は未測定 |
| NFR3 / NFR3.1〜NFR3.6 | U1〜U7 | ローカル境界はテスト済み、HTTPS/インフラは未検証 |
| NFR4 / NFR4.1〜NFR4.2 | DB/repository/domain | 保存、取引、冪等性をテスト済み |
| NFR5 / NFR5.1〜NFR5.2 | U1 | 外部自動取得なし。外部停止時の動的試験は未実施 |
| NFR6 / NFR6.1〜NFR6.3 | Build and Test / CI | coverageとformatは測定・成功、CI実行は未確認 |
| NFR7 / NFR7.1〜NFR7.2 | Infrastructure/Operation | 規模・AWS・デプロイは今回未実施 |

## ACのカバレッジ

### U1 skeleton — traceability に記録済み

`AC1.1.1–AC1.1.3`、`AC1.2.1–AC1.2.2`、`AC1.3.1–AC1.3.5`、`AC1.4.1–AC1.4.2`、`AC2.1.1–AC2.1.6`、`AC2.4.1`、`AC6.1.1`、`AC7.1.1`、`AC7.2.1`、`AC9.1.1–AC9.1.5`、`AC9.1.8` が `OK`。U1 traceability に `Deferred` として記録された後続担当分は、U2/U4/U6/U7 の行で補完される。

### U2 taste-filter — `OK`

`AC4.1.1`、`AC4.1.2`、`AC4.3.1`、`AC4.3.2`、`AC2.3.1–AC2.3.2`、`AC2.2.1–AC2.2.5`、`AC2.5.1–AC2.5.3`、`AC2.4.1–AC2.4.2`。

### U3 shopping-list — `OK`

`AC2.6.1–AC2.6.3`、`AC3.1.1–AC3.1.5`、`AC3.2.1–AC3.2.2`。

### U4 meal-plan — `OK`

`AC5.1.1–AC5.1.5`、`AC5.2.1–AC5.2.2`、`AC5.3.1`、`AC5.4.1–AC5.4.2`、`AC5.5.1–AC5.5.4`、`AC5.6.1–AC5.6.2`、`AC9.1.6`。

### U5 cook-log — `OK`

`AC6.2.1–AC6.2.8`、`AC6.3.1–AC6.3.2`、`AC6.4.1–AC6.4.5`、`AC6.5.1–AC6.5.6`、`AC6.6.1–AC6.6.2`。

### U6 images — `OK`

`AC1.5.1–AC1.5.4`、`AC9.1.7`、`AC9.1.8`。

### U7 account-admin — `OK`

`AC7.1.2`、`AC7.1.3`、`AC7.2.1–AC7.2.3`、`AC7.3.1–AC7.3.2`、`AC7.4.1–AC7.4.2`、`AC7.5.1` が `OK` として記録されている。BR50.1〜BR50.28 も `OK` として記録されている。追加5件の target は脱退・アカウント削除・最後のメンバー脱退の実装を指す。

## 修正後の完全性確認

U7 の code-generation `traceability.json` に、実装先を次のとおり追加した。

| ID | Target | Status |
|---|---|---|
| AC7.3.1 | `src/api/routes/admin.ts` | OK |
| AC7.3.2 | `src/api/routes/admin.ts` | OK |
| AC7.4.1 | `src/domain/admin/index.ts` | OK |
| AC7.4.2 | `src/domain/admin/index.ts` | OK |
| AC7.5.1 | `src/domain/admin/index.ts` | OK |

JSON.parse による妥当性確認、AC 107件との照合、targetファイル存在確認を再実行した結果、未記載ACは0件、target欠落は0件である。

## 逆方向の確認

- 7ユニットの code-generation traceability の対象ファイルはすべて存在する。
- U1〜U7 の指定テストはすべて成功し、全体でも43 files / 719 tests passed。
- U4の `008_meal_plan_integrity.sql` とそのDB/APIテストは存在し、7日連続制約・複合FK・fail-closedを確認した。
- トレーサビリティに記録された5件は、U7のAPI・domain実装と101件のU7テストで裏付けられている。

## 最終判定

**PASS / Met**。AC 107件中107件がユニット成果物に追跡可能で、各targetファイルも存在する。性能、実ブラウザ、AWS固有項目の未検証は、この追跡完全性の判定とは別に Build and Test サマリーで `Unverified` として扱う。
