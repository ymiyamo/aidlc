## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T04:17:05Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/infrastructure-design/infrastructure-specification.md > 基盤のサービス「データベース」「接続の束ね」「規模（サイズ）」、Assumptions & Open Questions | データベースの容量が「最小 0.5 から」と書かれており、「使わないとき最小まで縮める」と同時に「縮んだ状態からの再開の遅れ」を心配している。0.5 が下限なら停止せず再開の遅れはなく、停止するなら下限は 0 のはずで、どちらか決まっていない。また、接続の束ね（RDS Proxy 相当）は常時課金で、データベースに触れない死活確認や、関数を VPC の私的サブネットに置くための外向き通信（Secrets Manager・ログへの経路。NAT か VPC エンドポイント）の費用も書かれていない。「使わない間の費用が小さい」という Q2 A の理由と食い違う可能性があり、NFR Design が基盤設計に預けた「接続の束ね方」と「費用への影響」（reliability-design OQ1、scalability-design OQ1）に答えていない | 容量の下限を「0.5 で止まらない」か「0 で停止する」かのどちらかに決める。接続の束ねを置く理由（同時 10 人・関数 1 つで要るか）と、常時の月額の目安（束ね・外向き通信・データベース）を書く。関数の外向き通信の経路を明示する。費用が Q2 A の理由と合わない場合は、利用者に確認する事項として残す | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/infrastructure-design/infrastructure-specification.md > 基盤のサービス「スケジュール」「検証環境の入口の制限」、traceability.json > NFR2.5 | NFR Design が預けた「死活確認の入口を公開の制限の対象外にするか」（reliability-design OQ1）が決まっていない。スケジュールが関数を直接呼ぶのか入口経由かも不明で、検証環境の認証があると確認が常に失敗し、「止まった」の誤通知になりうる。さらに NFR2.5（立ち上がりの遅れ 3 秒以内、15 分以上あけて 5 回測定）は、自分のパソコンのコンテナ（Q7 A）では測れず、AWS に作る前は未検証なのに、traceability では OK になっている。測定は死活確認を止めて行う（observability-design）という手順も CI/CD や監視に反映されていない | 死活確認の経路（呼び出し方と認証の扱い）を決めて書く。NFR2.5 は「未検証。AWS 作成後に測定」と明記して OK から「設計済み・要測定」に改める。測定のときに死活確認を止める手順と、CI の検証環境の確認（流れ 4）が温め役にならない扱いを書く | New |
| R-03 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/infrastructure-design/infrastructure-specification.md > 基盤のサービス「配信網」「API の入口」、検証環境の入口の制限 | 検証環境の制限を配信網（CloudFront 相当）で行うとしているが、API の入口は別の公開 URL を持ち、そこへ直接アクセスすれば制限を通らない。総当たり対策が U7 まで無い間の補いは NFR3.4 のこの制限だけなので、抜け道は重大である。また本番にはこの制限の記述が無く、本番の公開は承認時の目視確認だけで、技術的な歯止めが無い。「共有の合言葉 or 許可する接続元」も未決で、CloudFront には標準の簡易認証がない | API の入口を配信網経由に限る（直接の URL を無効にするか、配信網だけが付ける秘密のヘッダーを検証する）ことを書く。制限の方式を 1 つに決める。本番は、U7 完成まで同じ制限を既定で有効にし、解除は承認と別の明示操作にする。環境ごとの設定として書く | New |
| R-04 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/infrastructure-design/cicd-pipeline.md > 段階とゲート「検証環境へ配る」、秘密情報（CI/CD）、infrastructure-specification.md > ネットワーク | データベースは私的サブネットにあり外から届かないのに、デプロイの段階が「データベースの移行（スキーマ）」を行うとしている。GitHub Actions からは届かず、実行場所（VPC 内の移行用の関数など）と使う権限が書かれていない。「CI に接続情報を置かない」とも矛盾しうる。OIDC の権限も、どのリポジトリ・ブランチ・環境（staging／production）だけが引き受けられるか、関数・データベース・秘密情報の権限の範囲、セキュリティグループの許可（関数→束ね→データベースのみ）が書かれておらず、「本番の権限は承認のあとだけ」を実現する手段（環境の保護ルールと OIDC 条件の組み合わせ）も不明。開発者が推測なしに実装できない | 移行の実行方法（場所・権限・失敗時）を決めて書く。OIDC の信頼条件（リポジトリ、環境）、環境ごとの役割の最小権限、セキュリティグループの許可関係を表にする。AWS に実際に作る前の承認で確認する項目に含める | New |
| R-05 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/infrastructure-design/traceability.json > upstream_ids / coverage | NFR Design が扱う ID のうち、この基盤設計で実際に触れているものが upstream_ids と coverage に無い。NFR4.14、NFR4.15、NFR4.16、NFR4.18、NFR4.19（monitoring-design が根拠を引用し、ログ保管 30 日は仕様にある）、NFR4.11〜NFR4.13、NFR7.6（「選んだもの」の一意性。7.4・7.5・7.7 は N/A で載せているのに抜けている）、NFR5.2、NFR1.3〜NFR1.5、NFR4.7 が欠けている。nfr-design/traceability.json の upstream と比べて網羅されておらず、監視の ID が穴になっている。また NFR3.4 や NFR2.5 は、方式が「コード生成で決める」のに OK になっている | upstream_ids を NFR Design と揃え、欠けた ID を coverage に追加する（監視の ID は monitoring-design の節に、NFR7.6 は N/A の理由つきで）。方式が未決のものは OK でなく「部分」や「要測定」と書く | New |
| R-06 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/infrastructure-design/infrastructure-specification.md > データベース、Assumptions & Open Questions | 暫定の明示は概ね良いが、質問にない決定のうち「日本向けの配信」「API の基本の制限」「同時実行の上限なし」「通知先メール」「Secrets を起動時に読む」のうち一部は [assumption] に載っていない。また、Aurora 系は自動バックアップの保持を完全には切れないことが多く、「取らない」と書いても実際は 1 日程度残る場合がある。誤ってスタックを消すとデータが無くなる | [assumption] に未記載の決定を足す。バックアップは「提供元の標準の保護に頼らない」と整合する表現にし、データベースに削除保護を付けることを書く | New |
| R-07 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/infrastructure-design/cicd-pipeline.md > ローカルでの確認 | Q7 A の「まずローカル」と記述は大筋で整合しているが、ローカルでの確認が NFR6.3 の検証コマンドの代わりになるのか、ローカルでの接続情報の扱い（リポジトリに入れない設定ファイル）、AWS の構成コードを作る範囲（合成と差分の確認のみか）が書かれていない | ローカルで確認できること（保存・候補）とできないこと（NFR2.5、制限、束ね）を表にし、構成コードは合成と差分までで作成しないと明記する | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 手動の照合（nfr-design/traceability.json の upstream と infrastructure-design/traceability.json の upstream_ids） | 不一致：NFR1.3〜1.5、4.7、4.11〜4.16、4.18、4.19、5.2、7.6 が欠落 | 上の Major（traceability）の根拠。coverage の ID はすべて NFR Design に実在し、実在しない ID は無い |
| 機械的な検証コマンド | 実行していない（この段階の検証ツールは渡されていない） | 該当なし |

### Summary

Q7 A（まずローカル、AWS への作成は別承認）との整合は取れているが、データベースの縮退と常時課金の部品（接続の束ね、外向き通信）の関係が未整理で、死活確認と検証環境の認証、API の入口の抜け道、私的データベースへの移行経路、権限の範囲が決まっておらず、traceability も監視の ID に穴がある。そのため NOT-READY とした。急ぎの場合は、AWS に作る前の承認までに上の Major を直せば、ローカルで 1st バージョンを触ること自体は妨げない。
