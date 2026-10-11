# 業務ルール：U4 献立（meal-plan）

「こういうときは、こうする」という決めごとです。正（source of truth）は下の yaml ブロックです。ルール番号は `BR30.{連番}`（BR30 = 献立）です。U1 の BR1〜BR4 と重ならないようにしています。

## 根拠（Sources）

- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U4 の節、`stories.md` の US5.1〜US5.6、AC9.1.6
- [requirements] FR5.1〜FR5.9、FR4.2、FR12.5、NFR2
- [memory] ADR-005（householdId で絞る）、ADR-008（料理の論理削除）、ADR-009（ID だけの参照）、ADR-010（献立が材料を渡す）、契約 C2（SuggestionJudge、DishCatalog、ShoppingListCompose）

## ルールの定義

```yaml
rules:
  # ---------- 基本の形 ----------
  - id: BR30.1
    statement: 献立は、開始日から連続する 7 日分。開始日は利用者が指定でき、なければ提案を作った日。
    category: policy
    applies_to: [MealPlan, PlanDay]
    trigger: 提案を作る
    logic: "THEN 開始日 = 指定があればその日、なければ提案を作った日。PlanDay を 7 件、連続した日付で作る。日数は増減しない"
    violation: "日付の形式が正しくなければ入力エラー"
    source: [FR5.1]
    decision: Q1 A
  - id: BR30.2
    statement: 提案に使う料理は、候補の判定（SuggestionJudge）に一括で問い合わせて受け取る。家族の誰かが除外した食材を含む料理と、削除済みの料理は、含まれない。
    category: constraint
    applies_to: [MealPlan]
    trigger: 提案を作る、やり直し
    logic: "THEN 候補の判定に householdId を付けて 1 回だけ問い合わせ、「除外済み・並び替え済み」の料理の一覧を受け取る（料理ごとの問い合わせはしない）。母集団は「削除済みでない全部の料理（除外・並び替え後）」で、「選んだもの」を除かない（U1 の BR4.1 の「選んだものを除く」は買い物前の 1 件ずつの表示専用。献立用には、選んだものを除かない取得を U1 に足す。Code Generation の作業：listCandidateIds に includePicked の指定を足す）。U4 は除外の中身（好き嫌い）を知らず、結果だけを使う。除外の本物の実装は U2、U1 の時点では除外なし。受け取った一覧にない料理は、提案にも、日のやり直しにも使わない"
    violation: "（提案に除外された食材を含む料理が入ったら設計の欠陥）"
    source: [FR4.2, FR5.2, AC5.1.4]
  - id: BR30.3
    statement: 同じ料理は、1 つの献立の中で 3 回以上入らない（2 回まで）。
    category: constraint
    applies_to: [PlanDay]
    trigger: 提案、やり直し、手割り当て、呼び出し
    logic: "IF 献立の中で、同じ dishId が dayStatus assigned の日に 3 件以上になる THEN その状態を作らない。数えるのは assigned の日だけ（skip と empty は数えない）"
    violation: "提案では起きない（探索が避ける）。手割り当てでは「同じ料理は 1 週間に 2 回までです」と断る（BR30.17）"
    source: [FR5.3, AC5.1.2]
  - id: BR30.4
    statement: 「主な食材の種類」が同じ日が 3 日続かない。種類が未入力の料理は、この判定の対象外。
    category: constraint
    applies_to: [PlanDay]
    trigger: 提案、やり直し、手割り当て、呼び出し
    logic: "IF 連続する 3 日の PlanDay がすべて assigned で、3 日とも料理の ingredientKind が入っていて同じ値 THEN その並びを作らない。skip の日、empty の日、ingredientKind が未入力の料理は、続きを途切れさせる（数えない）。手割り当て（BR30.17）では断らず注意を出す"
    violation: "提案では起きない。手割り当てでは「同じ種類が 3 日続きます」と注意を出して割り当てる"
    source: [FR5.4, AC5.1.3]
    decision: Q3 A

  # ---------- 提案 ----------
  - id: BR30.5
    statement: 提案は、制約（BR30.2〜BR30.4）をすべて満たす組み合わせを探して決める。乱数は外から差し替えられる。1 回の提案では、同じ料理を 1 回までしか使わない。
    category: calculation
    applies_to: [MealPlan, PlanDay]
    trigger: 提案を作る
    logic: |
      対象は、作らない日（skip）以外の日。
      1) 候補の判定の一覧（BR30.2。選んだものを除かない全部の料理）を、乱数で並べ替える（乱数の源は差し替え可能。同じ乱数列なら同じ結果になる）。
      2) 日付順に 1 日ずつ、まだ使っていない料理のうち、BR30.4 に反しないものを当てはめる。
      3) 当てはまる料理がなければ 1 つ前の日に戻り、別の料理でやり直す。すべて戻っても無理な日は、探索の上限（BR30.7）に達していなければ、その日を空欄にして先へ進む。
      検証できる性質：
      (P1) 結果の assigned の日は、BR30.2、BR30.3、BR30.4 をすべて満たす。
      (P2) 提案では同じ料理が 2 回以上現れない（Q4 A）。
      (P3) 完全性：対象の料理が対象の日数以上あり、制約を満たす割り当てが存在するなら、空欄は 0 件になる。
      (P4) 乱数だけが違う 2 回の提案は、どちらも P1〜P3 を満たす（結果が同じとは限らない）。
    violation: "P1〜P3 のどれかが破れたら設計の欠陥"
    source: [FR5.1, FR5.2, FR5.3, FR5.4, AC5.1.1, AC5.1.2, AC5.1.3, AC5.1.4]
    decision: Q2 A, Q4 A
  - id: BR30.6
    statement: 条件を満たす料理が 7 件以上あれば、7 日分が埋まった献立を返す。
    category: calculation
    applies_to: [MealPlan]
    trigger: 提案を作る
    logic: "IF 作らない日がなく、対象の料理が 7 件以上で、制約を満たす割り当てが存在する THEN 7 日すべて assigned になる。作らない日があれば、その日を除いた日数分が埋まる"
    violation: "（BR30.5 の P3 が破れたら設計の欠陥）"
    source: [FR5.1, AC5.1.1, AC9.1.6]
  - id: BR30.7
    statement: 保存した料理が 200 件以下のとき、提案は 3 秒以内に返す。候補の問い合わせは 1 回にまとめ、探索には回数の上限を置く。
    category: constraint
    applies_to: [MealPlan]
    trigger: 提案を作る、週全体のやり直し
    logic: "候補の問い合わせは 1 提案につき 1 回（BR30.2）。探索の回数が上限に達したら、まだ決まっていない日を空欄（理由は no_valid_combination）にして結果を返す。上限の値と測り方は NFR Requirements で決める"
    violation: "（性能の目標。測り方と合格の基準は NFR Requirements で決める）"
    source: [NFR2, AC5.1.5]
  - id: BR30.8
    statement: 料理が足りなくて埋められない日は空欄にし、理由と、料理を保存する案内を出す。
    category: policy
    applies_to: [PlanDay]
    trigger: 提案の結果の表示
    logic: "IF 対象の料理が日数より少なく、料理を当てはめられない日がある THEN その日は dayStatus empty、emptyReason not_enough_dishes。制約の組み合わせが理由で埋められない日は no_valid_combination。空欄の日には、理由の文と「料理を保存する」への入口（U1 の保存の入口）を表示する。空欄があっても、他の日の提案は有効な結果として返す"
    violation: "なし（エラーにしない）"
    source: [FR5.6, AC5.3.1]

  # ---------- やり直し ----------
  - id: BR30.9
    statement: 日ごとのやり直しは、その日だけを別の料理に変える。他の日は変えない。
    category: policy
    applies_to: [PlanDay]
    trigger: 「この日をやり直す」
    logic: |
      対象の日が skip なら、変えずに「作らない日はやり直せません。先に解除してください」と断る。
      それ以外の日（assigned でも empty でも）について、候補の判定の一覧（BR30.2）から、他の日の内容に対して BR30.3 と BR30.4 を満たし、現在の料理と違う料理を探す（乱数は差し替え可能）。
      見つかれば、その日を assigned（origin suggested）にする。empty の日なら、これで埋まる。
      検証できる性質：他の 6 日は変わらない。変わった日の料理は、見つかれば元の料理と異なる。
    violation: "他に使える料理がないときは、元の状態のまま変えず、「他に使える料理がありません」と案内する（空欄にはしない）。他のグループの献立は「見つからない」（BR30.20）"
    source: [FR5.5, AC5.2.1]
  - id: BR30.12
    statement: 週全体のやり直しは、作らない日以外の全日を、別の組み合わせに変える。「作らない」の設定は保つ。
    category: policy
    applies_to: [MealPlan, PlanDay]
    trigger: 「週全体をやり直す」
    logic: "THEN skip の日を固定して、それ以外の日に BR30.5 の提案をやり直す。以前の割り当て（手で割り当てた日を含む）は置き換わる。別の組み合わせが存在するなら、結果は直前の割り当てと全く同じにならない（可能なら各日の料理も直前と変える）。別の組み合わせが存在しなければ、直前と同じでよく、「他の組み合わせがありません」と案内する"
    violation: "（結果は常に BR30.5 の P1〜P3 を満たす）"
    source: [FR5.5, AC5.2.2]

  # ---------- 作らない日 ----------
  - id: BR30.10
    statement: 「この日は作らない」を設定すると、その日は作らない日になり、料理は割り当てられない。
    category: policy
    applies_to: [PlanDay]
    trigger: 「この日は作らない」の設定
    logic: "THEN dayStatus を skip にし、dishId、origin、emptyReason を空にする（すでに料理があれば外す）。すでに skip なら何もせず成功（同じ操作を繰り返しても結果は同じ）。skip の日には、提案（BR30.5）、やり直し（BR30.9）、手割り当て（BR30.17）で料理を入れない"
    violation: "他のグループの献立は「見つからない」（BR30.20）。保存済みの献立への設定は断る（BR30.14）"
    source: [FR5.8, AC5.5.1]
  - id: BR30.11
    statement: 「この日は作らない」を解除すると、その日はふつうの日（空欄）に戻り、料理を提案させられる。
    category: policy
    applies_to: [PlanDay]
    trigger: 「作らない」の解除
    logic: "THEN dayStatus を empty、emptyReason を not_proposed にする。料理は自動では入れない（以前の料理は復元しない）。利用者が日のやり直し（BR30.9）、または手割り当て（BR30.17）を行うと、料理が入る。すでに skip でなければ何もせず成功（冪等）"
    violation: "保存済みの献立への解除は断る（BR30.14）"
    source: [FR5.8, AC5.5.4]
  - id: BR30.13
    statement: 「空き」の数に、作らない日は数えない。数えるのは dayStatus が empty の日だけ。
    category: calculation
    applies_to: [MealPlan, PlanDay]
    trigger: 献立の表示、候補が足りない日の数の表示
    logic: "空きの数 = dayStatus が empty の PlanDay の数。skip と assigned は数えない。作らない日の数は、空きとは別に表示してよい"
    violation: "なし"
    source: [FR5.8, AC5.5.3]

  # ---------- 保存と呼び出し ----------
  - id: BR30.14
    statement: 献立を保存できる。保存した献立の日の内容は、保存後に変わらない。
    category: policy
    applies_to: [MealPlan]
    trigger: 「保存する」
    logic: "THEN 作業中の MealPlan の isSaved を true、savedAt を現在時刻にし、name を付ける（指定がなければ「M/D からの献立」）。保存したあとは、その MealPlan の PlanDay を変える操作（やり直し、作らない、割り当て、解除）を受け付けない。すでに保存済みなら何もせず成功（冪等）。保存済みの一覧に追加される。保存済みの数に上限は置かない"
    violation: "name が 50 文字を超えたら入力エラー。他のグループは「見つからない」（BR30.20）。保存済みの献立を変える操作は「保存した献立は変更できません。呼び出して使ってください」と断る"
    source: [FR5.7, AC5.4.1]
    decision: Q5 A
  - id: BR30.15
    statement: 保存した献立を呼び出すと、その写しが新しい作業中の献立として開く。作業中の献立は、1 つのグループにつき 1 件まで。
    category: policy
    applies_to: [MealPlan, PlanDay]
    trigger: 「呼び出す」、新しい提案を作る
    logic: |
      呼び出し：保存済みの MealPlan の写しを、isSaved false、新しい planId で作る（PlanDay も写す。startDate は同じ）。保存済みの元は変わらない。
      写したあと、各日を確かめる：料理が削除済み、または新しく除外された（候補の判定の一覧（BR30.2）にない）日は、「選んだもの」であることだけでは変えず、assigned を empty（emptyReason dish_unavailable）に変えて、理由を表示する。確かめたあと BR30.3 と BR30.4 に反する並びになっていれば、それは変えず注意を表示する。
      作業中の献立が 1 件あるときに、新しい提案または呼び出しをすると、前の作業中の献立は捨てられ（保存済みは捨てない）、新しいものが作業中になる。
      変更後に「保存」すると、別の保存済みの献立として加わる（元は上書きしない）。
    violation: "他のグループの保存済み献立は「見つからない」（BR30.20）。作業中を捨てるとき、確認の文言を画面に出す"
    source: [FR5.7, AC5.4.2]
    decision: Q5 A

  # ---------- 選んだものの割り当て ----------
  - id: BR30.16
    statement: 献立の画面を開くと、「選んだもの」が、日に割り当てる候補として表示される。
    category: policy
    applies_to: [PlanDay]
    trigger: 献立の画面を開く
    logic: "THEN 候補の判定（SuggestionJudge）の「選んだものの一覧」に householdId を付けて問い合わせ、削除済みを除いて、割り当て候補として並べる。U4 は PickedItem を複製せず、読むだけ。選んだものが 0 件なら、候補の欄は空で、「買い物前で選ぶ」への入口を出す"
    violation: "なし"
    source: [FR5.9, AC5.6.1]
  - id: BR30.17
    statement: 日に料理を手で割り当てられる。同じ料理が 3 回以上になる割り当ては断る。食材の種類が 3 日続くときは注意を出して割り当てる。作らない日には割り当てられない。
    category: policy
    applies_to: [PlanDay]
    trigger: 「この日にこの料理を入れる」
    logic: |
      対象の料理は、候補の判定の一覧にある料理（BR30.2。「選んだもの」も含む）、または「選んだもの」（BR30.16）。
      IF 対象の日が skip THEN 断る（先に解除する）。
      IF その料理がすでに 2 日に入っている（BR30.3） THEN 断る。
      IF 割り当てると BR30.4 に反する並びになる THEN 注意を出して、割り当てる。
      THEN その日を assigned（origin assigned_by_user）にする。すでに料理があれば置き換える。同じ料理を同じ日に割り当て直しても結果は同じ。
    violation: "skip の日、3 回目の割り当て、保存済みの献立への割り当ては断る。他のグループの料理・献立は「見つからない」（BR30.20）"
    source: [FR5.9, AC5.6.2]
    decision: Q6 A

  # ---------- 買い物リストへの受け渡し ----------
  - id: BR30.18
    statement: この献立の買い物リストは、作らない日・空欄の日を除く、料理がある日の材料を、買い物リストの窓口（ShoppingListCompose）に渡して作る。
    category: policy
    applies_to: [MealPlan, PlanDay]
    trigger: 「この献立の買い物リストを作る」
    logic: "THEN dayStatus が assigned の日の料理の材料だけを集め、料理の一覧の窓口（DishCatalog）で取った材料の行を、householdId と planId を付けて渡す。skip の日と empty の日の料理は、含めない（含める料理がそもそもない）。削除済みの料理の日は含めず、「削除済みの料理は材料に含めていません」と案内する。材料が未入力の料理は、その料理名を渡して、買い物リスト側が「材料の入力が必要」を付けられるようにする。合算（同じ材料で単位も同じものをまとめる）は買い物リスト（U3）の担当で、U4 はしない。買い物リストは献立を知らない（ADR-010）"
    violation: "作らない日の料理を含んだら設計の欠陥。assigned の日が 0 件のときは「材料がありません」と案内して作らない"
    source: [FR5.8, AC5.5.2]

  # ---------- 初期データだけで動く ----------
  - id: BR30.19
    statement: 初期データの 30 件は、すべて「主な食材の種類」を持つ。初期データだけで、7 日分が空欄なしで提案される。
    category: constraint
    applies_to: [Dish, MealPlan]
    trigger: 初期データの登録、提案
    logic: "初期データの各料理に ingredientKind を付ける（データファイルを更新する）。種類は 3 種類以上に分かれ、どの 1 種類も全体（30 件）の半分以下にする（偏りすぎると、3 日続けない制約で 7 日分が埋まらなくなるため）。検証できる性質：初期データだけのグループで、作らない日がなく、どの乱数列でも、BR30.5 の提案が空欄 0 件・BR30.3・BR30.4 を満たす。料理の側（U1）の Dish に ingredientKind を足す変更を、料理の持ち主の責任で行う（entities.md の「他のユニットに求める追加」）。利用者が保存する料理は、ingredientKind が未入力でもよい（BR30.4 の対象外になる）"
    violation: "（空欄が出たら設計の欠陥。データファイルを直す）"
    source: [FR12.1, FR12.3, FR12.5, AC9.1.6]

  # ---------- グループの範囲・削除 ----------
  - id: BR30.20
    statement: 献立の操作と問い合わせは、すべて householdId で絞る。他のグループの献立、日、料理は「見つからない」と同じに扱う。
    category: authorization
    applies_to: [MealPlan, PlanDay]
    trigger: すべての献立の操作・取得
    logic: "THEN 入口で確かめた householdId（ADR-005）を、MealPlan と PlanDay の取得・更新・保存の条件に必ず含める。他のコンポーネントへの問い合わせも、同じ CallContext（householdId、memberId）を付ける。人は memberId だけを値として持ち、名前は持たない（ADR-009）"
    violation: "存在するが他のグループのものは、存在しないのと区別がつかない形で「見つからない」を返す"
    source: [NFR3]
  - id: BR30.21
    statement: 料理が削除されても、保存済みの献立には残す。作業中の献立では、削除済みの料理の日は使えない日として扱う。
    category: policy
    applies_to: [PlanDay, Dish]
    trigger: 献立の表示、提案、やり直し、買い物リスト
    logic: "保存済み：dishId は残し、料理の一覧の窓口（getMany、削除済みを含む）で名前を引いて「削除済み」の印をつけて表示する。作業中：表示は同じで、削除済みの日は日のやり直し（BR30.9）で別の料理にできる。提案・やり直し・割り当ての候補には、削除済みを含めない（BR30.2）。買い物リストには含めない（BR30.18）"
    violation: "なし"
    source: [ADR-008]
  - id: BR30.22
    statement: 「グループが削除された」出来事を受けたら、そのグループの献立をすべて消す。同じ出来事を何度受けても結果は同じ。
    category: policy
    applies_to: [MealPlan, PlanDay]
    trigger: household.deleted の出来事
    logic: "THEN その householdId の MealPlan と PlanDay を、保存済み・作業中を問わずすべて消す。すでに消えていれば何もせず成功。出来事は少なくとも 1 回届き、順序は保証されない（ADR-007）"
    violation: "なし"
    source: [ADR-007]
```

## ルールの概要

| ルール | 内容 |
|---|---|
| BR30.1 | 7 日分、開始日は指定または提案した日 |
| BR30.2 | 提案の料理は、候補の判定に一括で聞く（除外・削除済みを含めない） |
| BR30.3 | 同じ料理は週 3 回未満 |
| BR30.4 | 食材の種類が同じ日は 3 日続かない（未入力は対象外） |
| BR30.5 | 制約を満たす組み合わせを探す。乱数は差し替え可能。検証できる性質 P1〜P4 |
| BR30.6 | 7 件以上あれば 7 日分が埋まる |
| BR30.7 | 200 件以下で 3 秒以内。問い合わせ 1 回、探索に上限 |
| BR30.8 | 足りない日は空欄にして理由と保存の案内 |
| BR30.9 | 日ごとのやり直し（他の日は変えない） |
| BR30.10 / BR30.11 | 「この日は作らない」の設定・解除 |
| BR30.12 | 週全体のやり直し（作らない設定は保つ） |
| BR30.13 | 空きの数に作らない日を数えない |
| BR30.14 | 保存（保存後は変わらない） |
| BR30.15 | 呼び出しは写し。作業中は 1 件まで |
| BR30.16 | 選んだものを割り当て候補として表示 |
| BR30.17 | 手割り当て（3 回目は断る、種類の連続は注意、作らない日は不可） |
| BR30.18 | 買い物リストへ、料理がある日の材料だけを渡す |
| BR30.19 | 初期データに食材の種類を付け、空欄なしで 7 日分 |
| BR30.20 | householdId で絞る。他のグループは見つからない |
| BR30.21 | 削除済み料理の扱い |
| BR30.22 | グループ削除の出来事で献立を消す |

## 補足

- HTTP の状態番号は Contract Design（C1）の担当であり、ここでは「入力エラー」「見つからない」「断る」の言葉で書く。
- BR30.7 の「3 秒」と探索の上限は、NFR Requirements で測り方と値を決める。
- 候補の判定が返す「並び順」（U5 の「もう作りたくない」を後ろにずらす）は、層の情報（先頭の層 / 後ろの層）が得られれば「先頭の層を先に使う」として BR30.5 の手順 1 に反映する。層の情報が契約にない間は、並び順を使わず全体を乱数で並べる（要確認：契約の SuggestionJudge.pickCandidates が層を返せるか）。
- 用語：「食材の種類」は Dish.ingredientKind（meat 肉 / fish 魚 / vegetable 野菜 / egg_soy 卵・大豆 / other その他）。
