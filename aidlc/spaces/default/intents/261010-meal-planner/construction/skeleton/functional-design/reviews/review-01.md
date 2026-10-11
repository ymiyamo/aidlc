## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T03:49:37Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/entities.md > Account / Membership / Dish.createdByAccountId / PickedItem.pickedByAccountId | 上流の設計（components.md、contract-summary.md）では、家族グループのメンバーは memberId を持つ Member（displayName、leftAt を持つ）で、Dish.createdBy、PickedItem.memberId、CookRecord.memberId、DislikedIngredient.memberId はすべて memberId を指す。U1 の設計は Membership（membershipId）に変え、表示名を Account に置き、作成者・選んだ人を accountId で参照している。このままでは U2・U5・U7 が memberId で参照する前提と食い違う。また、退会時に「名前を消す」「退会したメンバー」と表示する（ADR-009、BR2.5）には、表示名がメンバー側にある必要がある。Account に表示名があり、アカウント削除で Account を消すと、Dish と PickedItem の作成者参照の表示先がなくなる。 | 人の参照を memberId（Membership の ID）に統一する。Dish.createdBy と PickedItem.memberId を memberId 参照に直す。表示名は Membership 側に置いて退会時に消す形にするか、Account 側に置くなら、アカウント削除後の表示の流れを BR2.5 に書く。上流の名前（Member / Membership）が違う理由を entities.md に明記する。 | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/rules.md > BR2.2、BR3.12、「補足」／functional-spec.md > WF1 手順 7 | 初期データの複製を、グループ作成と同じ 1 つの処理（失敗したら全部取り消し）として書いている。一方、上流の契約（household.created の受け手が料理で、初期データ 30 件を登録する）と ADR-007（at-least-once、冪等、届かなかったときは後から整える）は、出来事で伝える設計である。「補足」では「受け手は初期データの複製に使わない」とあり、契約と明確に食い違う。家族グループと料理は別コンポーネントなので、1 つの処理で全部取り消す前提が成り立つかも示されていない。出来事を出す時点も、同じ処理の中か、後かが決まっていない。 | どちらかに揃える。(a) 契約どおり、グループ作成後に household.created を受けた料理が seedKey で冪等に複製し、取りこぼしは初回アクセス時に不足分を補う。(b) 同期の 1 処理にするなら、contract-summary と ADR-007 の変更を明記し、承認を得る。いずれの場合も、複製が失敗または途中の状態でホームを開いたときの利用者への見え方を書く。 | New |
| R-03 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/rules.md > BR4.1 と BR4.11 | BR4.11 は「外すと、その料理はまた候補の対象に戻る」と書くが、BR4.1 の対象は「削除済みでない料理すべて」で、選んだ料理を除外していない。選んだ料理が、見終わり後や「最初から見る」で再び候補に出るのか、選んでいる間は候補から外れるのかが決まらない。BR4.7（二重に入れない）と BR4.5（見終えるまで 2 回出ない）の挙動も、どちらかで変わる。検証できない記述になっている。 | 選んだものを候補の対象に含めるか除くかを 1 つに決め、BR4.1、BR4.5、BR4.11 を揃える。除くなら、「最初から見る」でも除くか、AC2.1.2 の「選んだもの」との関係を明記する。 | New |
| R-04 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/traceability.json > AC7.2.1 | AC7.2.1 は「グループを作り招待リンクを発行する」で、後半は U7 の担当なのに status が OK になっている。U1 だけでは、この AC は満たされない。 | status を Partial 等にして、U7 に残る部分を Deferred として分けて書く。ID の数え方が許さない場合は、OK の target に残りの扱いが U7 の機能設計の入力になることを明記する。 | New |
| R-05 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/traceability.json > AC9.1.8 | AC9.1.8 は、データファイルと画像の差し替えを求める。データファイル側は BR3.12 で U1 が満たすが、全体を U6 に Deferred としている。U1 で確認できる部分が残る。 | データファイルの差し替えは U1（BR3.12）で OK、画像の部分だけ U6 と分けて書く。 | New |
| R-06 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/entities.md > Dish、PickedItem、Dish.ingredients | 上流の名前と食い違う。isSample / isDeleted / cookTimeBand / pickedId / ingredientId を持つ Ingredient に対し、U1 は source+seedKey / deletedAt / cookTime / pickedItemId / ingredientId なしの DishIngredient。U2〜U6 が上流の名前を前提に設計すると混乱する。 | 上流との対応表を entities.md に 1 つ置くか、上流の名前に揃える。DishIngredient に ID が要らない理由（料理の一部）も明記する。 | New |
| R-07 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/rules.md > BR3.9 | 料理の削除で PickedItem も外すと書くが、PickedItem は候補の提案（Suggestion）の持ち物で、料理の削除処理が他コンポーネントのデータを直接変えるように読める。ADR-008 は「削除の出来事を伝えなくてよい」としている。 | 削除済みの料理を含む PickedItem は、一覧の取得時に除いて表示しないルールにする（削除の連鎖を持たない）。外す必要があるなら、受け口を誰が作るかを書く。 | New |
| R-08 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/rules.md > BR1.2、BR2.1、BR4.7 | 同時に 2 つの登録・作成・「これにする」が来たときの扱いが書かれていない（同じメールアドレスの同時登録、同じ人が同時に 2 つのグループを作る、同じ料理の同時選択）。重複の確認だけでは、同時実行で重複が入りうる。 | 「同時に来ても結果が 1 件のまま」を、各ルールの制約として明記する（一意性を最終的に守る）。 | New |
| R-09 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/rules.md > BR3.7 | 「同じ URL」の判定が決まっていない（末尾のスラッシュ、大文字小文字、http と https）。初期データのダミー URL が重複した場合に、利用者が警告を受けるのかも不明。 | 比較の方法（例：入力文字列の完全一致）を決める。初期データ（source = seed）は重複確認の対象外と書く。 | New |
| R-10 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/rules.md > BR1.2、BR1.5、BR2.3、BR3.1、BR3.4 ほか／functional-spec.md > 範囲・他ユニットとの境界 | 技術非依存を謳いながら、HTTP の状態番号（400/401/404/409）と「C1 REST」への言及がある。passwordDigest は名前として許容範囲。 | 状態番号は「入力エラー」「未ログイン」「見つからない」「競合」の言葉にして、番号は Contract Design の担当とする。 | New |
| R-11 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/rules.md > BR2.2、BR3.12 ／ entities.md > Account.displayName、Household.name | 表示名（50 文字以内）とグループ名（50 文字以内、初期値「わが家」）の検証ルールがない。BR3.12 の「ファイルの内容が不正」の基準もない（30 件に満たない場合、必須項目の欠落など）。 | 表示名とグループ名の検証を BR1 / BR2 に足す。データファイルの正しい形（件数、必須項目、BR3.1〜BR3.5 を満たすこと）を 1 行で決める。 | New |
| R-12 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/functional-design/entities.md > 画面側だけで持つ情報 | 「BR4.3、BR4.4」とあるが、パスの一覧を扱うのは BR4.3 と BR4.5。BR4.4 は 0 件の案内。また、保存した項目の一覧の内容・順序を決めるルールがない（AC1.1.1、AC1.4.1 の「一覧に表示」）。 | 参照を BR4.3、BR4.5 に直す。一覧の対象（削除済みを除く）と並び順を 1 つのルールにする。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| なし（この助言型レビューでは実行していない） | 該当なし | 参照の突き合わせは、成果物と上流文書を読んで手作業で行った。 |

### Summary

U1 担当 AC の対応表は、おおむね漏れなく、Deferred の先も妥当だった。しかし、人の参照（memberId と accountId）と初期データ登録の方式（出来事か同期か）が上流の契約と食い違い、候補の対象に選んだものを含むかも決まっていないため、この 3 点を直すまで NOT-READY とする。
