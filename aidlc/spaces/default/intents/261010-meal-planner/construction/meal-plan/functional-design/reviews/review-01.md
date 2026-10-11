## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T06:20:44Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/meal-plan/functional-design/rules.md > BR30.2、BR30.15、BR30.16、BR30.17、BR30.5 (P3) ／ functional-spec.md > 要確認 2、V3 | 提案・やり直し・呼び出しの確認はすべて「候補の判定（pickCandidates）が返す一覧」を料理の母集団にしている。ところが U1 の確定した設計（construction/skeleton/functional-design/rules.md > BR4.1）と実装（src/repo/dishes.ts の listCandidateIds、src/domain/suggestion.ts）は、候補から「選んだもの」を除いている。そのため次の矛盾が起きる。(a) 利用者が「選んだもの」から日に割り当てた料理（BR30.17）は、一覧にないので、保存して呼び出すと dish_unavailable の空欄に変わる（BR30.15）。(b) 選んだ料理は提案に使われず、料理が 5 件で 3 件選んでいれば 2 日分しか埋まらず、V3・P3・BR30.6 の期待（5 日埋まる、7 件以上なら 7 日埋まる）が成り立たない。(c) 「選んだもの」が多いほど AC9.1.6 に近い状況でも空欄が出うる。契約 C2 の pickCandidates は「除外済み・並び替え済み」としか書かず、選んだものを含めるか決めていない。要確認 2 は並び順の層だけを挙げ、この点に触れていない。 | 提案・やり直しの母集団を「削除済みでない全部の料理（除外・並び替え後）」と定め、「選んだもの」を除かないと明記する。そのために、U1 の BR4.1 のうち「選んだものを除く」は買い物前の 1 件ずつの表示専用とし、献立用の取得（pickCandidates）は選んだものを除かない、と U1 の契約・設計の追加として entities/rules に書く（Code Generation で U1 側に足す変更として記録する）。BR30.15 の「候補の判定の一覧にない」は「削除済みまたは除外された」に言い換え、選んだものであることでは dish_unavailable にならないと検証項目（V）に加える。 | New |
| R-02 | Minor | rules.md > BR30.5 (P3) と BR30.7 | P3（完全性：満たす割り当てがあれば空欄 0 件）は無条件に書かれているが、BR30.7 は探索の上限に達したら残りを空欄にする。上限の値が決まるまで P3 は検証できない。 | P3 に「探索の上限内で」を足すか、上限は 30 件の初期データで V1 が通る値以上、と条件を書く（メモ）。 | New |
| R-03 | Minor | rules.md > BR30.9 と BR30.5 (P2) | 提案では同じ料理は 1 回まで（P2）だが、日のやり直しは BR30.3（2 回まで）を使うので、やり直し後に同じ料理が 2 回現れうる。 | やり直しでも「まだ使っていない料理を優先する」か、2 回まで許すと明記する（メモ）。 | New |
| R-04 | Minor | entities.md > 他のユニットに求める追加 ／ functional-spec.md > 要確認 1 | Dish.ingredientKind は契約（contract-summary.md の Dish）に既にあるが、要確認 1 は「U1 にない」とだけ書く。また、利用者が料理を保存・編集するときに種類を入力できるかが書かれていない（入力できないと BR30.4 は初期データにしか効かない）。 | 契約にある項目を U1 の実装に足す、と書き直し、保存・編集の入力欄に含めるかを Code Generation の入力として明記する（メモ）。 | New |
| R-05 | Minor | traceability.json > AC5.1.5 | AC5.1.5（3 秒）は BR30.7 が測り方を NFR Requirements に先送りしているが、status は OK。 | Partial 等にして NFR Requirements への引き継ぎを target に書く（メモ）。 | New |
| R-06 | Minor | rules.md > BR30.13 | 「まだ提案していない」（not_proposed）の空欄も「空き（候補が足りない日）」に数える。AC5.5.3 の「候補が足りない日」とは意味が異なる。 | 候補不足の空欄（not_enough_dishes、no_valid_combination）だけを数えるか、数える対象を明記する（メモ）。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 手動の突き合わせ（AC 網羅） | US5.1〜US5.6 と AC9.1.6 の 17 件すべてが traceability.json にあり、target の BR が rules.md に存在する | 網羅は取れている。AC5.1.5 の OK は過大（Minor） |
| 手動の突き合わせ（U1 の設計・実装・ADR） | BR4.1（選んだものを候補から除く）と U4 の母集団の前提が食い違う。ADR-005/007/008/009/010 とは矛盾なし | 上の Major 1 件 |
| 技術非依存 | 特定の技術名・HTTP 番号の記述なし（HTTP は補足で C1 に委譲） | 問題なし |
| 質問にない決定 | 保存名 50 文字、保存数の上限なし、手割り当て日も週やり直しで置換、は質問外だが軽微 | メモ程度 |

### Summary

重大な指摘は 1 件です。U4 が頼る「候補の一覧」は U1 の実装では「選んだもの」を含まないため、選んだものを割り当てた献立が呼び出しで空欄に変わり、料理が少ないときは提案も埋まりません。母集団の定義を直せば、他の設計は実装に進める水準です。
