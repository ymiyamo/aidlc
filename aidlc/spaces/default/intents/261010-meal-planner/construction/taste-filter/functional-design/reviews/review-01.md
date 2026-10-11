## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T06:20:18Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/taste-filter/functional-design/rules.md > BR10.25、functional-spec.md > 他のユニットとの境界（U1 の行） | 「U1 の既定の実装（空の一覧を返す）を本物に差し替える」と書いているが、U1 の実装（src/domain/suggestion.ts の nextCandidate、src/domain/events.ts）には TasteExclusion の窓口も既定の実装もない。nextCandidate は householdId と見た料理の ID だけを受け取り、除外・絞り込み・件数・おまかせの入口がない。「差し替えるだけ」という前提が実態と違う。 | U2 が U1 の候補取得に足す部分（TasteExclusion 窓口の新設と既定の実装、nextCandidate への絞り込み条件・除外の追加、件数とおまかせの入口）を、U2 の作業として明記する。「U1 にある前提」の記述は直す。 | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/taste-filter/functional-design/entities.md > U1 の設計との関係（cookTime 行）、rules.md > BR10.10 / BR10.13 | 契約 C1・C2 は調理時間を `longer`（Dish は `cookTimeBand`、絞り込みの `time`）としており、U1 の実装は `over30`（`cookTime`）。設計は over30 を正としつつ「要確認」のまま残している。さらに、C1 には「条件に合う件数」と「気分のタグの選択肢」を返す窓口がない（BR10.10、BR10.13 が要る）。U4 が使う SuggestionJudge の filter も `longer` のままで、食い違いが U4 に持ち越される。 | over30 を正とする決定をここで確定し、契約 C1・C2 の `longer`／`cookTimeBand` を直す必要があることと、件数・タグ選択肢の窓口を契約に足す必要があることを、設計の確定事項として書く（契約の修正は持ち主のユニットで行う）。 | New |
| R-03 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/taste-filter/functional-design/rules.md > BR10.21、BR10.22、BR10.6、functional-spec.md > Assumptions & Open Questions OQ1 | 出来事の「少なくとも 1 回届く」「失敗したら再送される」を前提にしているが、U1 の出来事の仕組み（src/domain/events.ts）はアプリ内の呼び出しで、再送も eventId もなく、失敗は送り手に影響しない作り。つまり再送は起きず、抜けた人・削除されたグループの登録が残りうる。BR10.6 は「抜けた人の分はすでに消えている」と書くため、残ると除外が過剰になり、手当ては OQ1 で先送りされている。 | 出来事が届かなかったときの手当てを、いまの設計で決める。たとえば、BR10.6 の除外一覧を作るとき、現在のメンバー（退会していない人）の登録だけを使うと決める。BR10.21 の再送の前提は、U1 の仕組みに合わせて書き直す。 | New |
| R-04 | Minor | traceability.json > AC4.1.2、unit-of-work-story-map.md | AC4.1.2 の「献立」の部分は U4 の担当だが、story-map では US4.1 が U2 だけに割り当てられている。traceability.json 側には注記があるので、メモ程度。 | story-map の備考に「US4.1 の献立の部分は U4」と足すか、U4 の機能設計で拾うことを確認する。 | New |
| R-05 | Minor | rules.md > BR10.3 | 50 件の上限は、同時に別の食材を登録すると超えうる（BR10.2 は同じ名前の重複だけを守る）。メモ程度。 | 上限は超えても実害が小さいことを明記するか、確実に守る旨を書く。 | New |
| R-06 | Minor | rules.md > BR10.8、functional-spec.md > Assumptions & Open Questions | 「選んだもの」は除外が増えても外さない決定は、質問では聞かれておらず、仮定として書かれている。安全側ではなく利用者の判断に任せる扱い。メモ程度。 | 承認のときに、仮定として人に確認してもらう。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability.json の目視照合 | OK の 15 件の BRx.y（BR10.1、10.2、10.5〜10.18、10.19 ほか）は rules.md に実在。Deferred は AC2.4.1 のみで、移譲先の U1 の BR4.4 は U1 の rules.md に実在 | 担当 AC の網羅は問題なし。AC4.1.2 は部分的に U4 へ（Minor に記載） |
| 技術非依存の確認 | 技術名は YouTube（AC2.5.2 に由来）のみ。URL の安全な変換は技術に触れず書けている | 問題なし |
| U1 実装との照合（src/） | TasteExclusion、member-left／household.deleted の型、eventId、再送はいずれも未実装 | Major 1、Major 3 の根拠 |

### Summary

担当 AC の網羅と traceability、ルールの整合・冪等性、技術非依存はおおむね良好です。ただし、U1 にはない窓口を「ある」前提にしていること、契約と実装の食い違い（`longer` と over30、件数・タグ選択肢の窓口）が確定していないこと、出来事の再送を前提にしていることの 3 点が Major で、実装で迷う原因になります。直せば READY になる見込みです。
