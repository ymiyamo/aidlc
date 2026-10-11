## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T06:19:55Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/shopping-list/functional-design/rules.md > BR20.13 (3)、functional-spec.md > WF4 手順 4、entities.md > ShoppingList | 「買い物おわり」のあと、選んだものを外す処理が失敗したときの「外し残し」を、次の操作でやり直すと書いてあるが、どの料理が外し残しかを覚えておく項目が ShoppingList にない（ShoppingList には sourceDishIds も外し済みの印もない）。また、やり直しは料理の ID で外す（U1 の実装 unpick も dishId 指定）ため、完了後に誰かがその料理を選び直していると、新しく選んだものまで消してしまう。さらに、リストを開く操作でやり直しと同期のどちらを先にするかが書かれておらず、同期が先だと外し残しの料理が新しい作成中リストに入ってしまう | 外し残しを覚える項目（例：完了したリストに「外し済みか」の印と、外す対象の料理の ID の一覧、または完了時刻）を ShoppingList に足す。やり直しは、完了時刻より前から選ばれていたものに限る、のような条件を決める。開く操作での順序（やり直しを同期より先に行う）を BR20.3 または BR20.13 に書く | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/shopping-list/functional-design/rules.md > BR20.5、BR20.7（数として扱える分量の定義） | 質問にない決定が、設計の中心の挙動に入っている。分数（1/2）・全角数字・「0 より大きい」・小数第 2 位の四捨五入表示は、Q1〜Q6 のどれにも出てこない。しかも「0」や「2〜3」は text 扱いになり別の行になるため、AC3.1.2 の「分量が合算されて 1 行になる」の範囲を狭めている。assumption に分数・小数が挙がっているが、0 の扱いと四捨五入は挙がっておらず、承認で確認されない | 「0」の扱いと表示の丸め方を、Assumptions & Open Questions に [assumption] として足し、承認で確認できるようにする（質問に戻す必要はない） | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 目視の照合（stories.md、unit-of-work-story-map.md、contract-summary.md、decisions.md、U1 の設計・src/domain/suggestion.ts、src/repo/picked.ts） | 担当 AC（AC2.6.2〜3、AC3.1.1〜5、AC3.2.1〜2）は traceability.json で網羅。AC2.6.1 は U1 に Deferred（U1 の一覧で満たされるため許容）。U1 の ST2・BR4.11（外す＝dishId 指定で冪等）とは整合。技術非依存 | OQ1 の窓口は、U1 の実装が dishId 指定の unpick を持つため解消できる。OQ2（上流の ShoppingItem との差）は対応表で説明済み |

### Summary

U1 との整合、AC の網羅、合算と冪等の基本は問題ない。ただし完了後の「外し残し」の扱いに、状態の持ち場所と順序の抜けがあり、実装者が推測しないと作れない。上の 2 件（Major 2 件）を直せば READY。

軽微（メモ）：(a) entities.md の「空です」の案内の参照が BR20.10 になっているが、正しくは BR20.12。(b) BR20.12 の statement（材料の行が 0 件）と logic（入力が必要の行だけなら空ではない）が食い違う。(c) BR20.16 の「削除された料理」は、削除済みの料理が U1 の取得で除かれるため、needsInput の行では起こらない。(d) 献立用リストの完了操作（BR20.14）の受け口が、WF に書かれていない。
