## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T04:04:00Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/nfr-requirements/reliability-requirements.md > 受け入れたリスク RISK-1、NFR4.7、Assumptions OQ1。同 traceability.json > NFR4 の target 注記。同 tech-stack-decisions.md は影響なし | 利用者は F1 で B（本番でもバックアップも可用性の目標も置かない。データが消えるリスクを承知する）を選んだ。F1 の「本番前に決め直す」は A の内容だった。しかし NFR4.7 は「本番に出す前に決め直す。決め直さずに本番に出さない」と定めている。RISK-1 の根拠にも「本番に出す前に、利用者へもう一度確認する」とある。つまり回答にない出荷条件を、勝手に置いている。F1 B と NFR4.7 は矛盾する。質問ファイルの F1 A と B の説明とも逆になっている | NFR4.7 を削除するか、「推奨（任意）」に変える。RISK-1 の根拠は「F1 B：本番でも承知のうえで受け入れた」に直す。OQ1 と traceability.json の「本番前に NFR4.7 で決め直す」も同様に直す。本番前の確認を残したい場合は、利用者に別途確認して、回答として記録する | New |
| R-02 | Major | 同 nfr-requirements/ 全成果物の ID（NFR1.1〜NFR7.10）と traceability.json | 派生 ID が上流 `requirements.md` の NFR ID と同じ番号で、意味が違う。例：上流 NFR2.1 は「候補 2 秒以内」だが派生は「サーバー 500ms」。上流 NFR2.2 は「週の献立 3 秒」、NFR2.3 は「買い物リスト 1 秒」だが、派生の NFR2.2 は「最初の候補 2 秒」、NFR2.3 は「保存などの 500ms」。上流 NFR3.5 は入力検証、NFR3.6 は画像だが、派生の NFR3.5 はグループの確定、NFR3.6 は「見つからない」。上流 NFR4.2 は「バックアップ方針」だが派生は「中途半端な状態を残さない」。上流 NFR7.1 は自動デプロイ、NFR7.2 は想定規模だが、派生の NFR7.1 は規模、NFR7.2 は 200 件。このため traceability.json の `coverage` は、上流 ID との対応が読めない。また、U1 の範囲外のものも OK になっている。上流 NFR3.1 の「5 回失敗で 15 分停止」は U1 で行わない（派生 NFR3.4）。上流 NFR2.2 の週の献立、NFR2.3 の買い物リスト、NFR3.6 の画像は U1 に無い。いずれも「OK」と記録されている。上流 NFR1.2 は、同じ ID の派生と一致して見える | 派生 ID に別の接頭辞（例：`U1-NFR2.1`）を付けるか、対応表（上流 ID → 派生 ID）を traceability.json に持たせる。U1 の範囲外の上流 ID（NFR2.2、NFR2.3、NFR3.1 のロック、NFR3.6 の画像、NFR4.2 のバックアップ方針）は、「OK」ではなく「対象外（U7 / U3・U4 / U6）」「受け入れたリスク」と区別して記録する | New |
| R-03 | Minor | performance-requirements.md > NFR2.1、NFR2.3、NFR2.4 と補足 | 立ち上がりの遅れ（コールドスタート）を、95 パーセンタイルの計測から外している。家族向けの小さなアプリは、リクエストの間隔が空きやすく、遅れた最初のリクエストが普通の体験になる。「常に 1 つ起動しておく」案は、Q3 B の理由（使わない間の費用が小さい）と食い違う。NFR2.1 のように 100 回の計測で p95 を出す場合も、外した分の扱いが曖昧 | 立ち上がりの遅れが出る割合と時間を、別の数値として記録する（例：最初のリクエストは 3 秒以内など、暫定でよい）。NFR2.2 の計測は 1 回でなく複数回行う、と書く | New |
| R-04 | Minor | observability-requirements.md > NFR4.17、NFR4.15 | エラー率「5 分間で 5% 超」は、同時 10 人程度の利用では、リクエストが数件でも 5% を超えて誤通知になりやすい。F2 A は「数値の目標は置かない」が、これは可用性の目標のことで、通知の基準の暫定値は許容できる（暫定と明記されている点は適切） | 「最小件数（例：5 分間で 20 リクエスト以上）のときだけ判定する」を足すか、エラー件数の絶対数で判定する | New |
| R-05 | Minor | tech-stack-decisions.md > 決定の表「動かす場所」 | 状態が「決定（Q3 B）」だが、AWS という事業者は、Q3 の回答にない。Assumptions に「AWS は Q3 の質問文からの延長」とあり、表の状態と食い違う | 事業者の部分を「暫定」にして、「サーバーレス」を決定、「AWS」を暫定、と分けて書く | New |
| R-06 | Minor | security-requirements.md > NFR3.4、Assumptions | 「通し版は公開せず、検証環境の限られた利用者だけが使う」の約束が、どう守られるか（アクセスの制限の手段）が書かれていない。F1 B で本番にも出せる前提なので、U7 より前に本番へ出る場合の扱いが曖昧 | 制限の手段（検証環境の入口の制限など）を暫定で書く。U7 の前に本番へ出さない約束を、NFR7.10 の本番承認の条件に結びつける | New |
| R-07 | Minor | security-requirements.md > NFR3.14 と observability-requirements.md > NFR4.13 | ログに出さないもの一覧が揃っていない。NFR4.13 は「料理の URL」を含むが、NFR3.14 は含まない | NFR3.14 に料理の URL を足すか、NFR4.13 を正本にして参照する | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 手作業の照合（質問 Q1〜Q10、F1、F2 と成果物） | Q1〜Q10、F2 は反映されている。F1 B は NFR4.3、NFR4.4、RISK-1、RISK-2 に反映されているが、NFR4.7 が F1 B と逆の約束をしている | Major 1 件。Q4 の 500ms と 2 秒、Q7 の遅れ通知を F2 A で外した点は、Assumptions に明記されていて適切 |
| 要件 NFR1〜NFR7 の網羅 | NFR1〜NFR7 のすべてに派生 ID がある。NFR4.1（失われない）は、通常の保存の範囲として NFR4.1 と NFR4.3 で整合が取れている | 派生 ID が上流 ID と衝突している（Major 1 件）。U1 範囲外の上流項目が OK と記録されている |
| 機能設計（BRx.y）との整合 | BR1.2、BR1.5、BR2.1〜BR2.4、BR3.9、BR3.12、BR4.7、BR4.10 の参照は実在し、内容も整合している。サーバーレス構成との矛盾する記述はない（NFR7.8、NFR7.9、NFR4.8 の補完で整合） | 問題なし |
| traceability.json の構文と実在 | JSON として正しい。target の ID は成果物内に実在する（NFR4.9、NFR4.10 は欠番で、target にも無い） | 欠番は問題なし。対応表の形に課題あり（Major 2） |

### Summary

質問への回答と機能設計との整合はおおむね取れているが、利用者が F1 B で選んでいない「本番前に決め直す」という出荷条件（NFR4.7）が置かれている点と、派生 ID が上流の NFR ID と衝突して追跡表が読めない点が、Major の指摘です。この 2 点を直せば READY にできます。
