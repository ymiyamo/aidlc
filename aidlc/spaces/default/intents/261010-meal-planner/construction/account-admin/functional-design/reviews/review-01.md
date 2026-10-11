## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T06:19:13Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/account-admin/functional-design/rules.md > BR50.12、BR50.20、functional-spec.md > WF4 手順 6 | 招待で参加するとき、表示名の初期値を「登録時の表示名」としているが、U1 の Account には表示名がない（表示名は Member だけが持つ。U1 entities.md の Account と、その relationships の注記）。登録時の表示名は、グループを作る Member にしか残らない。参加する人の表示名の出どころが決まっておらず、BR50.20 の「Account の表示名を空にする」も、消す対象がない。 | 参加時の表示名の出どころを決める（例：参加の画面で入力する、または U1 の既定「メールアドレスの @ より前」を使う）。BR50.12、WF4、BR50.20 の「Account の表示名」という言い方を直す。Account に表示名を足すなら、entities.md の added_attributes に書き、U1 の ADR-009 の説明との整合を取る。 | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/account-admin/functional-design/rules.md > BR50.12、BR50.16、BR50.22 | 「招待で参加」と「抜ける／最後の 1 人の判定とグループ削除」が同時に起きたときの決めごとがない。(a) 最後の 1 人が抜けてグループが消える瞬間に、別の人が有効な招待で参加すると、存在しない Household に Member ができる。(b) 2 人だけのグループで 2 人が同時に抜けると、互いに「他に有効な Member がいる」と見て、どちらもグループを削除せず、誰もいないグループが残る（AC7.5.1 を満たさない）。同時実行の保証が書かれているのは、同じリンクを 2 人が使う場合と失敗回数だけ。 | 「有効な Member の数の判定」と「グループ削除」「参加による Member の追加」を、同じグループに対しては 1 件ずつ確定する（直列にする）という振る舞いを BR50.12 と BR50.22 に足す。グループが削除済み、または削除中のとき、参加は「このリンクは使えません」とする。(b) の場合に、最後に抜けた人がグループを削除することを明記する。 | New |
| R-03 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/account-admin/functional-design/rules.md > BR50.2、BR50.19 | 質問（Q1〜Q6）にも、NFR3.1 にも、上流の決定にもない数値を、確認なしで決めている。BR50.2「再設定の発行は 1 時間に 3 回まで」、BR50.19「アカウント削除のパスワード再入力は、連続 5 回まちがえたら 15 分間受け付けない」。BR50.19 の方は補足で自分の判断と認めているが、質問にして承認されていない。画面の利用者の見え方も変わる（削除できなくなる）。 | 質問のない決定として、functional-design-questions.md の回答の外に出ていることを明示し、承認のときに確認できるようにする（根拠の節に [assumption] として書く）。または、数値を NFR Requirements に送る。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability.json の照合（手動） | OK の BR50.1〜BR50.22、BR50.25、BR50.28 は rules.md に実在する。N/A の BR50.23、24、26、27 も実在する。AC7.1.1 の Deferred は U1（BR1.1〜BR1.6）に送られ妥当 | 網羅は取れている。AC7.1.2、7.1.3、7.2〜7.5 の担当 AC はすべてルールに対応する |
| ID と参照の照合（手動） | U1 の BR1.x、BR2.x、ADR-005、007、009 への参照は実在し、矛盾しない（Member の leftAt、accountId 空、BR2.5 の表示は U1 と一致）。上の Major 1 件目だけが食い違い | 2 件目以降は U1 と整合 |
| 外部の検証ツール | 未実行（この段階に指定なし） | なし |

### Summary

担当 AC の網羅と U1・ADR との整合はおおむね取れているが、参加時の表示名の出どころが未定義であること、参加とグループ削除の同時実行の抜け、質問にない数値の決定の 3 点が Major です。メモ程度の軽微な点：(1) DomainEventRecord の householdId は、グループ削除後は参照先がなくなるので、ID だけの値として扱うと明記するとよい。(2) Account の email、passwordDigest を空にできるようにした場合の一意性は、「空は重複とみなさない」と一言あるとよい。(3) account.deleted の記録は Account が行うが、DomainEventRecord の持ち主は Household になっており、同じ処理で記録する範囲を NFR Design で整理するとよい。
