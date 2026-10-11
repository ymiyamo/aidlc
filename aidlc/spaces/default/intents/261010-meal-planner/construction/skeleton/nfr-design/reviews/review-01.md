## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T04:12:04Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/nfr-design/traceability.json > upstream_ids / coverage | 要件側に実在する U1-NFR4.11、4.12、4.16、4.17、4.18、4.19 が upstream_ids にも coverage にもない。observability-design.md は、これらを「満たす要件」として引用している（例：NFR4.11、NFR4.12、NFR4.16〜NFR4.19）ので、設計が根拠にしている要件が網羅表から抜けている。また ID は「U1-」を外して NFR4.13 のように書かれている。上流（全体）の NFR4.2 は「バックアップ」だが、U1-NFR4.3 が同じ内容、のように番号が食い違うため、設計の各ファイルの「NFR4.3」が上流と U1 のどちらを指すか判別できない。nfr-requirements の traceability.json は上流を NFR1〜NFR7 としており、本ファイルの upstream_ids とも粒度が合わない | 要件側の全 U1-NFRx.y（4.11、4.12、4.16〜4.19 を含む）を upstream_ids と coverage に入れ、ID の表記を「U1-」付きに統一する（設計 5 ファイルの「満たす要件」列も同様）。上流 NFR1〜NFR7 との対応を 1 か所に明記し、観測の 4.11、4.12、4.16〜4.19 の行き先（observability-design.md）を target に書く | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/nfr-design/observability-design.md > 死活の通知 と performance-design.md > 立ち上がりの遅れ | 死活の確認を 5 分ごとに呼び、しかも「データベースへの接続の確認を含む」（reliability-design.md > 死活の確認）。これは、(1) アプリを 5 分ごとに温め続けるので、U1-NFR2.5 の「15 分以上あけて開き直す」測定が成立せず、立ち上がりの遅れが実際より小さく見える。(2) データベースを 5 分ごとに起こすので、データベースが使わないときに止まる／安くなる型の場合、「使わない間の費用が小さい」というサーバーレス選択の理由（Q2 A の根拠）と矛盾する。Q2 A は「常に 1 つ起動しない」を選んだのに、実質的に常時起動と同じ効果になる。この影響は設計のどこにも書かれていない | 死活の確認の間隔と、データベース接続の確認を含めるかを見直す（例：間隔を 15 分超にする、データベース確認は別の入口にする、または効果を承知のうえで温め続けると明記して費用を見積もる）。NFR2.5 の測定は、死活の確認を止めた状態で行うと設計に書く。OQ1（死活の入口を公開の制限の対象外にするか）と合わせて、Infrastructure Design で決める項目として残す | New |
| R-03 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/nfr-design/security-design.md > 認可 | ADR-005 は、出来事（リクエストの外）は householdId を必ず持ち、受け側がそれで絞ると定める。reliability-design.md の household.created の受け手（初期データの登録）と「ホームを開いたときの補完」について、security-design.md には householdId で絞る旨がない | 出来事の受け手も householdId を必須の引数にし、入口の確認を通らないことを security-design.md に 1 行書く | New |
| R-04 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/nfr-design/performance-design.md > OQ1（先読み） | 「1 件先まで先読み」は、質問にない決定で、BR4.3（見た料理は出さない）と衝突しうる。暫定扱いと OQ はあるが、「先読みしただけで見た扱いにしない」を既定にするかが決まっていない | 既定を「先読みは見た扱いにしない」と書き、コード生成で確認すると明記する | New |
| R-05 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/nfr-design/scalability-design.md > 規模の見立て | 「設定で上限を置かない」は質問にない決定で、暴走や攻撃時の費用の上限がない（公開の制限があるため、検証環境では許容できる） | 暫定と明記し、Infrastructure Design で同時実行の上限の要否を決める | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 手作業の ID 突き合わせ（nfr-requirements の U1-NFR 一覧 と traceability.json） | 要件側 58 件のうち、U1-NFR4.11、4.12、4.16、4.17、4.18、4.19 が coverage にない。実在しない ID は見つからない | 網羅の穴が 1 件目の Major。ID の表記（U1- の有無）も不統一 |
| 要件との矛盾の確認（F1 B、サーバーレス、立ち上がり、BR2.3/2.4、ADR-005） | バックアップなし（F1 B）、可用性目標なし、論理削除、グループ必須の問い合わせ、入口 1 か所化は要件と整合。矛盾は死活の確認と立ち上がり／費用の 1 点 | 2 件目の Major。そのほかの暫定（再試行、2 秒の内訳、通知先、セキュリティヘッダー）は「assumption」と明示されている |

### Summary

バックアップなし、サーバーレス、入口での認可（BR2.3/2.4、ADR-005）は要件と整合し、暫定も概ね明示されている。ただし、トレーサビリティに観測の要件 6 件の抜けと ID 表記の不統一があり、5 分ごとの死活の確認が立ち上がりの測定と「使わない間の費用が小さい」という前提を崩す点が未整理のため、NOT-READY とする。
