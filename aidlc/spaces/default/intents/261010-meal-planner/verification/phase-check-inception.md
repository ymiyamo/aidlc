# 準備の段階（Inception）から作る段階（Construction）への移行の確認

**判定：PASS（問題なし）**

Inception の各ステージが作った `traceability.json` を読み、未解決の指摘（`GAP`、`ORPHAN`、対象が存在しない、元の ID の漏れ）がないことを確かめた。

## 確認した内容

| ステージ | ファイル | 元の ID の数 | 割り当て済み（OK） | 対象外・後回し（N/A、Deferred） | GAP | ORPHAN |
|---|---|---|---|---|---|---|
| User Stories | `user-stories/traceability.json` | 99（FR と NFR） | 83 | 16 | 0 | 0 |
| Domain Design | `domain-design/traceability.json` | 38（US1.1〜US9.1） | 33 | 5 | 0 | 0 |
| Units Generation | `units-generation/traceability.json` | 38（US1.1〜US9.1） | 33 | 5 | 0 | 0 |

Contract Design は、契約を決めるステージで、要件の割り当て表（`traceability.json`）を作らないため、この確認の対象外。

## 対象外・後回しの内訳

- **対象外（N/A）5 件**：US4.2（アレルギー）と、US8.1〜US8.4（次の版以降）。いずれも Won't で、理由を対象に書いてある。
- **後回し（Deferred）16 件**：非機能要件（NFR）のうち、次の段階で決めるもの。後回し先の段階が、すべて書いてある。
  - NFR 系（`nfr-requirements`）：画面のコントラスト、性能の測り方、HTTPS、バックアップ、外部サービスが止まったときの動きなど
  - `ci-pipeline`：テストの実行、整形・lint の強制（NFR6.1、NFR6.2）
  - `deployment-pipeline`：検証環境への自動デプロイ、本番の手動承認（NFR7.1）
  - `delivery-planning`：NFR6.3（最小の通し版の範囲）。**このステージで解決した**（`bolt-plan.md` の B1 = U1）。

## 結論

- GAP、ORPHAN、対象が存在しない、元の ID の漏れは、いずれも 0 件。
- Construction に進める。ただし、後回しの NFR は、次のステージ（NFR の段階、インフラの段階、CI、デプロイ）で決めるまで、実装の確認条件にならない。
