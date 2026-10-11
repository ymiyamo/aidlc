# 業務ルール設計：U3 買い物リスト
「こういうときは、こうする」という決めごとです。正（source of truth）は下の yaml ブロックです。ルール番号は `BR20.連番`（BR20 = 買い物リスト）です。U1 のルール（BR1〜BR4）と番号は重なりません。

## 根拠（Sources）
- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` U3 の節、`stories.md` の US2.6、US3.1、US3.2
- [scope] 要件 FR3.1〜FR3.5、NFR1.1、NFR2.3、NFR3.2、NFR4.1
- [memory] ADR-005、ADR-007、ADR-008、ADR-009、ADR-010
- [scope] U1 の `rules.md`（BR2.4 他のグループは「見つからない」、BR3.9 削除済みの料理、BR4.11 選んだものを外す）
- [assumption] 分量が「0」（0、0.0、0/3 など）は、数として扱わず、料理ごとの別の行（amountKind = text、元の書き方のまま）にする。合算の対象にしない（BR20.5、BR20.7）。質問にない決定。
- [assumption] 数の分量の表示は、整数なら整数、割り切れない小数は小数第 2 位まで四捨五入とする（BR20.5）。質問にない決定。

## ルールの定義
```yaml
rules:
  # ---------- BR20: 買い物リスト ----------
  - id: BR20.1
    statement: 買い物リストと、その行の問い合わせ・変更は、すべて、確認済みの householdId で絞る。他のグループのリスト・行は「見つからない」。
    category: authorization
    applies_to: [ShoppingList, ShoppingItem]
    trigger: 買い物リストの取得、チェックの付け外し、完了、献立からの受け取り
    logic: "IF 対象のリストまたは行の householdId が、入口で確認済みの householdId と違う THEN 対象がないものとして扱う。他のグループの itemId や dishId を渡されても、そのグループのデータにしか届かない"
    violation: "「見つからない」（U1 の BR2.4 と同じ文言・扱い）。何も返さず、何も変えない"
    source: [NFR3.2]
    decision: ADR-005

  - id: BR20.2
    statement: 「選んだもの」から作るリストは、1 つのグループにつき、作成中のものを 1 件だけ持つ。
    category: constraint
    applies_to: [ShoppingList]
    trigger: 買い物リストを開く
    logic: "IF 作成中の picked のリストがない THEN 新しく 1 件作る（行は BR20.3 で入れる）。IF すでにある THEN それを使う。同時に 2 人が開いても、作成中のリストは 1 件のまま（一意性を最終的に守る）"
    violation: "なし（エラーにしない）。2 件できた場合は 1 件にまとめる"
    source: [FR3.1, FR3.4]
    decision: Q1 A

  - id: BR20.3
    statement: 買い物リストを開くたびに、作成中のリストを、今の「選んだもの」にそろえる。選んだ料理の材料が入り、外した料理の材料が外れる。
    category: policy
    applies_to: [ShoppingList, ShoppingItem]
    trigger: 買い物リストを開く（取得）
    logic: "THEN 次の順で行う。(0) 先に、BR20.13 の外し残しのやり直し（unpickDone = false の完了済みリストがあれば）を行う。やり直しが失敗しても、(1) 以降は続ける。(1) U1 の窓口から、このグループの「選んだもの」を取る（削除済みの料理は、U1 が除いて返す［U1 の BR3.9］）。(2) 料理の窓口から、その料理の材料と分量を取る。(3) BR20.5〜BR20.8 で、あるべき行の一覧を作る。(4) 今の行と lineKey で比べ、無い行は足し、あるべき一覧に無い行は外し、同じ行は残す（チェックの扱いは BR20.11）。同じ操作を繰り返しても、結果は同じ（冪等）"
    violation: "「選んだもの」または料理の取得に失敗したら、リストを変えずに、前回保存した内容を表示し、「最新の状態にできませんでした」と知らせる。行を一部だけ変えた状態にしない（1 つの処理として反映する）"
    source: [FR3.1, FR3.2, FR2.8]
    decision: Q1 A

  - id: BR20.4
    statement: 選んだ料理の材料は、すべて買い物リストの行になる。
    category: policy
    applies_to: [ShoppingItem]
    trigger: 買い物リストの行の組み立て（BR20.3、BR20.14）
    logic: "IF 料理に材料が 1 行以上ある THEN その材料の 1 行ごとに、BR20.5〜BR20.7 のとおり行に反映する。複数の料理を選んだら、それぞれの材料を合わせて 1 つの一覧にする"
    violation: "なし"
    source: [FR3.1, FR3.2]

  - id: BR20.5
    statement: 材料名と単位が同じで、分量が数として扱えるものは、分量を足して 1 行にする。
    category: calculation
    applies_to: [ShoppingItem]
    trigger: 買い物リストの行の組み立て
    logic: "「同じ材料名」と「同じ単位」は、前後の空白を除いた文字が完全に同じことをいう（ひらがな・カタカナ・全角半角の読み替えはしない。Q2 A）。単位が空どうしは同じ単位。「数として扱える分量」は、整数、小数（例：1.5）、分数（例：1/2）で、全角数字も半角数字として読み、0 より大きいもの。IF 材料名・単位が同じで分量が数として扱える行が複数ある THEN 10 進の小数として正確に足し（0.1 + 0.2 が 0.3 になる）、1 行にする。lineKey は「材料名 + 単位」で決める。その行の sourceDishIds は、足した全部の料理を重複なく持つ。同じ料理の中に同じ材料・同じ単位の行が 2 つあっても足す。表示の分量は、整数なら整数（例：3）、割り切れない小数は小数第 2 位まで（四捨五入）とする"
    violation: "なし（足せない分量は BR20.7 に回る）"
    source: [FR3.3, FR3.1]
    decision: Q2 A

  - id: BR20.6
    statement: 材料名が同じでも、単位が違うものは、別の行として表示する。足さない。
    category: calculation
    applies_to: [ShoppingItem]
    trigger: 買い物リストの行の組み立て
    logic: "IF 材料名は同じで単位が違う（「単位なし」と「個」も違う）THEN 別の行にする。換算（g と kg、個と本など）はしない"
    violation: "なし"
    source: [FR3.3]
    decision: Q2 A

  - id: BR20.7
    statement: 数として扱えない分量（「少々」「適量」など）と、分量が空のものは、足さずに、料理ごとに別の行にする。
    category: calculation
    applies_to: [ShoppingItem]
    trigger: 買い物リストの行の組み立て
    logic: "IF 分量が数として扱えない（BR20.5 に当たらない。「2〜3」「ひとつかみ」を含む）THEN amountKind = text として、元の書き方のまま 1 行にする。IF 分量が空 THEN amountKind = none として、材料名と単位だけの 1 行にする。lineKey は「材料名 + 単位 + 分量の書き方 + 料理（dishId）」で決める。同じ料理に同じ材料・同じ単位・同じ書き方の行が 2 つあっても、1 行にまとめる。数として扱える行と、数でない行は、同じ材料名・単位でも足さない"
    violation: "なし"
    source: [FR3.3, FR3.2]
    decision: Q3 A

  - id: BR20.8
    statement: 材料が 1 行もない料理を選んだときは、その料理に「材料の入力が必要」と表示する。
    category: policy
    applies_to: [ShoppingItem]
    trigger: 買い物リストの行の組み立て
    logic: "IF 選んだ料理の材料が 0 行 THEN その料理 1 つにつき、kind = needsInput の行を 1 つ作る。行には料理名（料理の窓口から取る）と「材料の入力が必要」を表示する。lineKey は料理（dishId）で決める。この行はチェックの対象にしない（checked は常に false）。料理に材料が入力されたら、次に開いたとき（BR20.3）、この行は外れて、材料の行になる"
    violation: "なし。needsInput の行にチェックを付ける操作は受け付けない（BR20.10）"
    source: [FR3.2]

  - id: BR20.9
    statement: リストの行は、決まった順で並べる。チェックの付いていない行を上に、付いた行を下に置く。
    category: policy
    applies_to: [ShoppingItem]
    trigger: 買い物リストの表示
    logic: "THEN 並びは、(1) 「材料の入力が必要」の行を先頭、(2) チェックのない材料の行、(3) チェックのある材料の行、の順。同じ区分の中は、材料名の五十音順（文字コード順でよい）、同じ材料名なら単位の順。順番は保存しない"
    violation: "なし"
    source: [FR3.4]

  - id: BR20.10
    statement: 材料の行のチェックは、付け外しができ、保存される。再表示しても、他のメンバーが開いても残る。
    category: policy
    applies_to: [ShoppingItem]
    trigger: チェックの付け外しの操作
    logic: "操作は「この行を checked = true にする」「checked = false にする」と、結果の値を指定して行う（切り替えではない）。THEN 行の checked を指定の値にし、付けるときは checkedBy（操作した memberId）と checkedAt を記録する。外すときは checkedBy と checkedAt を空にする。同じ操作を繰り返しても結果は同じ。2 人が同時に操作したら、あとに処理されたほうが残る。チェックは、このグループのメンバー全員で共有する。IF 対象が needsInput の行 THEN 受け付けない。IF 完了したリストの行 THEN 受け付けない"
    violation: "他のグループの行は「見つからない」（BR20.1）。needsInput の行・完了したリストの行は「チェックできません」と表示し、何も変えない。保存に失敗したら、画面のチェックを元に戻し、「保存できませんでした」と知らせる"
    source: [FR3.4, NFR4.1]
    decision: Q4 A

  - id: BR20.11
    statement: 同期（BR20.3）のとき、同じ行はチェックを引き継ぐ。ただし、分量が変わった行はチェックを外す。
    category: policy
    applies_to: [ShoppingItem]
    trigger: 買い物リストを開く（BR20.3）
    logic: "IF 同じ lineKey の行が残り、分量（amountKind と amountNumber または amountText）が前回と同じ THEN checked、checkedBy、checkedAt を引き継ぐ。IF 同じ lineKey の行が残り、分量が前回と違う（例：玉ねぎ 2 個 → 3 個）THEN checked を false にし、checkedBy と checkedAt を空にする（増えた分の買い忘れを防ぐ。Q4 A）。IF 行が外れて、あとで同じ lineKey の行が戻る THEN 新しい行として扱い、チェックは外れている。sourceDishIds だけが変わった（分量は同じ）場合は、チェックを引き継ぐ"
    violation: "なし"
    source: [FR3.4, NFR4.1]
    decision: Q4 A

  - id: BR20.12
    statement: 「選んだもの」にも材料の行にも何もない（材料の行が 1 件もない）ときは、リストが空であることを表示する。
    category: policy
    applies_to: [ShoppingList]
    trigger: 買い物リストの表示
    logic: "IF 表示する行が 0 件（「選んだもの」が 0 件、または選んだ料理がすべて削除済み）THEN 「買い物リストは空です」と、候補を見る画面（U1）への入口を表示する。IF 「材料の入力が必要」の行だけがある THEN 空ではない（その行を表示する）"
    violation: "なし"
    source: [FR3.5]

  - id: BR20.13
    statement: 「買い物おわり」の操作でリストを完了し、そのリストの料理の「選んだもの」を外す。
    category: policy
    applies_to: [ShoppingList]
    trigger: 「買い物おわり」の操作
    logic: "IF 作成中の picked のリストがある THEN (1) 先に BR20.3 で、リストを今の「選んだもの」にそろえる。(2) リストを完了（status = completed、completedAt、completedBy）にし、同時に（同じ保存で）外す対象の dishId の一覧を unpickDishIds に、unpickDone = false で保存する。unpickDishIds は、そろえたあとのリストの行の sourceDishIds を重複なくまとめたもの。行はそのまま残す（履歴）。(3) unpickDishIds の料理の「選んだもの」を、U1 の「選んだものを外す」の窓口（U1 の BR4.11 と同じ処理）で外す。全部外せたら unpickDone = true にする。(4) 次に開いたとき、新しい作成中のリストを作る（BR20.2）。完了の操作を繰り返しても結果は同じ（すでに完了していたら成功として返す）。【外し残しのやり直し】(3) が失敗または中断し unpickDone = false のまま残ったリストがあるとき、次に「買い物おわり」の操作、またはリストを開く操作があったら、やり直す。やり直しで外すのは、unpickDishIds のうち、「選んだもの」の pickedAt が completedAt 以前のものに限る（完了後に選び直したもの［pickedAt が completedAt より後］は外さない）。外す処理は、すでに外れていても成功（at-least-once で安全）。終わったら unpickDone = true にする。【順序】リストを開く操作では、外し残しのやり直しを、BR20.3 の同期より先に行う（同期が先だと、外し残しの料理が新しい作成中リストに入るため）。チェックがすべて付いていなくても完了できる"
    violation: "他のグループのリストは「見つからない」（BR20.1）。完了したリストにチェックの変更は受け付けない（BR20.10）。(3) の失敗は、リストの完了を取り消さない"
    source: [FR3.1, FR2.8]
    decision: Q5 A

  - id: BR20.14
    statement: 献立（U4）が渡した材料からも、同じ集計ルールでリストを作る。献立用のリストは、「選んだもの」のリストとは別にする。
    category: policy
    applies_to: [ShoppingList, ShoppingItem]
    trigger: 献立から材料を受け取る（ShoppingListCompose の呼び出し）
    logic: "IF 献立（U4）が、確認済みの householdId、献立の ID（sourcePlanId）、材料の一覧（「作らない」日の料理を除いたもの。除く判断は U4）を渡した THEN source = mealPlan のリストを作る。材料の行は BR20.4〜BR20.8 と同じ規則で組み立て、「材料の入力が必要」の判断は、渡された料理に材料がないことで行う。同じ sourcePlanId の作成中のリストがすでにある THEN 中身を、渡された材料に置き換える（BR20.11 でチェックを引き継ぐ）。「選んだもの」のリストには触れない。U3 は献立の中身を持たず、渡された材料だけで作る（ADR-010）。献立用のリストの完了は、BR20.13 の (1)(2) と同じで、(3)（選んだものを外す）は行わない"
    violation: "他のグループの献立の ID でも、householdId で絞るため、そのグループのリストにしか届かない（BR20.1）。材料の一覧が空なら、空のリストを作る（BR20.12 で表示）"
    source: [FR3.1, FR3.3]
    decision: Q6 A

  - id: BR20.15
    statement: グループが削除されたら、そのグループの買い物リストと行を、すべて消す。
    category: policy
    applies_to: [ShoppingList, ShoppingItem]
    trigger: 出来事「グループが削除された」を受けた
    logic: "THEN その householdId のすべての ShoppingList と ShoppingItem を物理的に消す。同じ出来事を何度受けても、結果は同じ（冪等。ADR-007）。受け口は U3 が作る（U7 は出す側のみ）"
    violation: "消す対象がなければ、何もせず成功とする。出来事が届かなかった場合の補完は、グループの存在を入口で確認するため（ADR-005）、データに届かない"
    source: [FR7.6]
    decision: ADR-007

  - id: BR20.16
    statement: 人の参照は memberId だけを持つ。名前は持たず、表示のときに解決し、退会したメンバーは「退会したメンバー」と表示する。
    category: constraint
    applies_to: [ShoppingList, ShoppingItem]
    trigger: 完了、チェック、表示
    logic: "completedBy と checkedBy は memberId だけを値とする。表示するときは、グループの窓口から表示名を取る。IF メンバーが退会している THEN 「退会したメンバー」と表示する（U1 の BR2.5）。削除済みの料理の名前は、「削除された料理」と表示する（ADR-008）"
    violation: "なし"
    source: [FR7.5]
    decision: ADR-009

  - id: BR20.17
    statement: 買い物リストの作成・表示は、1 秒以内に結果を返す。スマートフォンの縦向き（画面幅 360px 以上）で、横スクロールなしに読める。
    category: constraint
    applies_to: [ShoppingList]
    trigger: 買い物リストを開く
    logic: "対象が「選んだもの」30 件以下・行 200 行以下のとき、リストを開いてから表示までを 1 秒以内にする（NFR2.3）。表示は 1 行 1 列の縦並びにし、材料名・分量・単位は折り返して表示する。チェックの操作の大きさは、指で押しやすい大きさにする。文字と背景の比は 4.5:1 以上（NFR1.4）"
    violation: "（目標。測り方は NFR Requirements で決める）"
    source: [NFR1.1, NFR1.4, NFR2.3]
```

## ルールの概要
| グループ | ルール | 内容 |
|---|---|---|
| BR20 | BR20.1 | グループで絞る、他のグループは「見つからない」 |
| BR20 | BR20.2〜BR20.4 | 選んだものから 1 つの作成中リスト、開くたびにそろえる、材料は全部入る |
| BR20 | BR20.5〜BR20.7 | 同じ材料・単位は合算、単位違いは別の行、数でない分量は料理ごとに別の行 |
| BR20 | BR20.8 | 材料がない料理は「材料の入力が必要」 |
| BR20 | BR20.9、BR20.12 | 並び順、空のときの表示 |
| BR20 | BR20.10、BR20.11 | チェックの保存（共有・冪等）、同期での引き継ぎ（分量が変われば外す） |
| BR20 | BR20.13 | 「買い物おわり」で完了し、選んだものが外れる |
| BR20 | BR20.14 | 献立から渡された材料のリスト（別リスト、集計は同じ） |
| BR20 | BR20.15、BR20.16 | グループ削除で消す、memberId だけを持つ |
| BR20 | BR20.17 | 1 秒以内、横スクロールなし |
