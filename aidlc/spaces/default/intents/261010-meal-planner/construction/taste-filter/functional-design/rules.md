# 業務ルール：U2 好き嫌いと絞り込み

「こういうときは、こうする」という決めごとです。正（source of truth）は下の yaml ブロックです。ルール番号は `BR10.{連番}` です（BR10 = U2 のグループ。U1 の BR1〜BR4 と重ならない）。

## 根拠（Sources）

- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` U2 の節、`stories.md`（US4.1、US4.3、US2.3、US2.2、US2.5、US2.4 の AC2.4.2）
- [contract] `contract-summary.md` の C2（TasteExclusion）、C3（household.member-left、household.deleted）、C1（/me/dislikes、/suggestions/next、/suggestions/random）
- [memory] ADR-004、ADR-005（入口の所属確認）、ADR-007（出来事は at-least-once、冪等）、ADR-009（ID だけの参照）
- [U1] U1 の `rules.md`（BR4.1〜BR4.8、BR3.4、BR3.5）

## ルールの定義

```yaml
rules:
  # ---------- BR10: 好き嫌いの登録と削除 ----------
  - id: BR10.1
    statement: メンバーは、自分の嫌いな食材を登録できる。食材名は、前後の空白を除いた 1〜50 文字にする。登録は、操作した本人の分として保存する。
    category: validation
    applies_to: [DislikedIngredient]
    trigger: 嫌いな食材の登録
    logic: "IF 前後の空白を除くと空、または 50 文字を超える THEN 登録しない。memberId と householdId は、ログイン状態から決める（画面の入力からは決めない）。空白以外は変えずに保存する（読み替えをしない）"
    violation: "「入力エラー」。「食材名は 1〜50 文字で入力してください」と表示し、入力を残す"
    source: [FR4.1, US4.1, AC4.1.1]
    decision: Q6 A
  - id: BR10.2
    statement: 同じメンバーが、同じ食材名を二重に登録しない。同じ操作を繰り返しても、結果は 1 件のまま。
    category: constraint
    applies_to: [DislikedIngredient]
    trigger: 嫌いな食材の登録
    logic: "IF 同じ memberId・同じ ingredientName（完全一致）の登録がすでにある THEN 新しく作らず、成功として返す。同時に同じ登録が 2 件来ても、1 件だけが成り立つ（一意性を最終的に守る）"
    violation: "なし（エラーにしない）"
    source: [FR4.1, ADR-007]
    decision: Q6 A
  - id: BR10.3
    statement: 1 人が登録できる嫌いな食材は、50 件までにする。
    category: constraint
    applies_to: [DislikedIngredient]
    trigger: 嫌いな食材の登録
    logic: "IF そのメンバーの登録がすでに 50 件ある（BR10.2 で既存と同じものを除く）THEN 登録しない"
    violation: "「入力エラー」。「登録できるのは 50 件までです。使わないものを外してください」と表示する"
    source: [FR4.1]
    decision: Q6 A
  - id: BR10.4
    statement: 嫌いな食材を外せるのは、登録した本人だけ。他の人の登録や、他のグループの登録は、存在しないものとして扱う。
    category: authorization
    applies_to: [DislikedIngredient]
    trigger: 嫌いな食材の削除
    logic: "IF 指定された dislikeId の登録の memberId が自分でない、または householdId が自分のグループと違う THEN 「見つからない」ものとして扱う。削除は物理的に消してよい（個人の好みの設定であり、履歴を残す要件はない）。同じ削除を繰り返しても結果は同じ（すでになくても成功）"
    violation: "「見つからない」（他の人の登録があることを教えない。ADR-005）"
    source: [FR4.1, US4.1, ADR-005]
    decision: Q6 A
  - id: BR10.5
    statement: 好き嫌いの画面には、自分の登録だけを、登録の古い順に出す。家族の登録は出さない。
    category: policy
    applies_to: [DislikedIngredient]
    trigger: 好き嫌いの一覧の表示
    logic: "対象 = 自分の memberId の登録。並び = registeredAt の古い順。他のメンバーの登録は、一覧にも件数にも出さない"
    violation: "なし"
    source: [FR4.1, AC4.1.1]
    decision: Q6 A

  # ---------- BR10: 除外の判定 ----------
  - id: BR10.6
    statement: 除外する食材の一覧は、そのグループの、現在のメンバー全員の嫌いな食材をまとめたものにする。他のグループの登録は含めない。
    category: calculation
    applies_to: [DislikedIngredient, ExcludedIngredientList]
    trigger: 候補・おまかせ・該当件数の判定
    logic: "対象 = householdId が自分のグループの DislikedIngredient のうち、登録した memberId が現在のメンバー（退会していない人。U1 の Member.leftAt が空）のもの『だけ』。抜けた人の登録が残っていても（BR10.21 の削除が届かなかった場合を含む）、一覧に入れない。同じ食材名はまとめて 1 つにする。一覧は保存せず、そのつど作る。誰が登録したかは、判定には使わない"
    violation: "なし"
    source: [FR4.1, FR4.2, US4.1, AC4.1.2, AC2.3.1, ADR-004]
  - id: BR10.7
    statement: 食材名の照合は、文字列の一致だけで行う。料理の材料名の中に、除外する食材名の文字列が含まれていれば一致とみなす（部分一致）。表記ゆれの正規化はしない。
    category: calculation
    applies_to: [Dish, DishIngredient, DislikedIngredient]
    trigger: 除外の判定
    logic: "IF 材料名が、除外する食材名を（文字列としてそのまま）含む THEN 一致。比較では、大文字小文字・全角半角・ひらがな/カタカナ/漢字の読み替えをしない。たとえば、「えび」を登録したとき、材料名「えび」「むきえび」は一致し、「海老」「エビ」は一致しない。照合の対象は材料名だけで、料理名・メモ・気分のタグは見ない"
    violation: "なし"
    source: [FR4.3, US4.3, AC4.3.1, AC4.3.2]
    decision: Q1 A
  - id: BR10.8
    statement: 材料のどれか 1 行でも一致した料理は、候補から外す。この除外は、候補（買い物前）、おまかせ、該当件数のすべてに適用する。すでに「選んだもの」に入っている料理は、除外が後から増えても外さない。
    category: policy
    applies_to: [Dish, PickedItem]
    trigger: 候補の取得、おまかせ、該当件数の計算
    logic: "IF 料理の材料のどれかが、BR10.7 で除外する食材のどれかに一致 THEN その料理は対象から外す。外すのは対象（候補）を作るときの判定で、料理のデータは変えない。「選んだもの」の一覧には手を加えない（利用者が自分で選んだものであり、外すかどうかは利用者が決める。U1 BR4.11）"
    violation: "なし"
    source: [FR2.9, FR4.2, US2.3, US4.1, AC2.3.1, AC4.1.2, AC4.3.1]
  - id: BR10.9
    statement: 材料が未入力の料理は、除外の判定の対象外とし、候補に出す。出すときは「材料が未入力」と明示する。
    category: policy
    applies_to: [Dish]
    trigger: 候補の表示
    logic: "IF 料理の材料が 0 行 THEN 除外せず、候補に出す。カードには、U1 BR4.8 の表示（「材料が未入力」）を出す。除外の登録がない場合も、同じ表示"
    violation: "なし"
    source: [FR2.9, US2.3, AC2.3.2]

  # ---------- BR10: 「今日の気分」での絞り込み ----------
  - id: BR10.10
    statement: 絞り込みの条件は 3 種類。調理時間（15 分以内 / 30 分以内 / それ以上、1 つだけ選ぶ）、手間（楽 / ふつう / 頑張れる、1 つだけ選ぶ）、気分のタグ（複数選べる）。気分のタグの選択肢は、グループの削除済みでない料理が持つタグを集めたものにする。
    category: validation
    applies_to: [Dish]
    trigger: 「今日の気分」のシートを開く、条件を選ぶ
    logic: "調理時間・手間の値は、U1 の選択肢（within15 / within30 / over30、easy / normal / hard）以外を受け付けない。気分のタグの選択肢は、グループの料理の moodTags を、重複なしで集める（そのつど作る）。選んだタグが、あとで料理から消えても、条件は有効のまま（0 件になりうる）。何も選ばなくてよい（BR10.12）"
    violation: "決められた選択肢以外の値は「入力エラー」"
    source: [FR2.2, US2.2, AC2.2.2, AC2.2.3]
  - id: BR10.11
    statement: 絞り込みは、指定した条件のすべてに合う料理だけを出す。調理時間と手間は、値が一致するもの。気分のタグは、選んだタグのどれか 1 つでも付いていれば合う。「30 分以内」は、15 分以内の料理も含める。条件を指定したのに、その項目が空の料理は、合わないものとして外す。
    category: calculation
    applies_to: [Dish]
    trigger: 候補の取得、該当件数の計算
    logic: "調理時間：「15 分以内」= within15 だけ。「30 分以内」= within15 と within30。「それ以上」= over30 だけ。IF 調理時間を指定していて、料理の cookTime が空 THEN 合わない。手間：指定した値と同じ effort だけ。IF 手間を指定していて、料理の effort が空 THEN 合わない。気分のタグ：IF 1 つ以上のタグを指定 THEN 料理の moodTags と共通するタグが 1 つ以上あるものだけ（共通がない、または料理のタグが空なら合わない）。3 種類の条件は AND で結ぶ（指定していない種類は、条件にしない）。タグの照合も、文字列の一致だけ（読み替えなし）"
    violation: "なし"
    source: [FR2.2, US2.2, AC2.2.2, AC2.2.3]
    decision: [Q2 A, Q3 A]
  - id: BR10.12
    statement: 絞り込みを何も指定しないときは、保存した全項目（除外後）から選ぶ。
    category: policy
    applies_to: [Dish]
    trigger: 候補の取得
    logic: "IF 3 種類の条件がすべて未指定 THEN 絞り込みの判定をしない。除外（BR10.8）と、U1 の対象（削除済みを除く、選んだものを除く、見た料理を除く）だけを適用する。初期データの料理も、利用者が保存した料理も区別しない"
    violation: "なし"
    source: [FR2.2, US2.2, AC2.2.1]
  - id: BR10.13
    statement: 「今日の気分」のシートには、いまの条件に合う料理の件数を出す。件数は、除外と絞り込みを適用した後の料理の数で、「選んだもの」と見た料理は数から引かない。
    category: calculation
    applies_to: [Dish]
    trigger: 条件を選ぶ・変える
    logic: "件数 = グループの削除済みでない料理のうち、BR10.8 で外されず、BR10.11 に合うものの数。条件を変えるたびに数え直す。0 件でも「見る」は押せるが、押すと BR10.19 の案内が出る"
    violation: "なし"
    source: [FR2.2, US2.2, AC2.2.2]
  - id: BR10.14
    statement: 絞り込みの条件は、画面が一時的に持つ。サーバーは保存しない。「見る」を押す、または条件を変えると、見た料理の一覧を空にして、選んだ条件の候補を最初から出す。
    category: policy
    applies_to: [Dish]
    trigger: 「見る」の操作、条件の変更
    logic: "画面は、候補を要求するたびに、条件を渡す（U1 BR4.3 の「見た料理の一覧」と同じ持ち方）。条件が変わったら、見た料理の一覧を空にする。条件を空にして「見る」を押すと、絞り込みなしの候補に戻る（BR10.12）。画面を閉じる、または再読み込みすると、条件は消える"
    violation: "なし"
    source: [FR2.2, US2.2, AC2.2.5]
  - id: BR10.15
    statement: 「今日の気分」のシートでは、横にスクロールせずに、すべての選択肢が見える。片手で選べる大きさにする。
    category: policy
    applies_to: [Dish]
    trigger: 「今日の気分」のシートの表示
    logic: "選択肢は折り返して並べる（横に流さない）。気分のタグが多いときも、折り返して全部見せる。選んだものが分かる印を付ける"
    violation: "なし"
    source: [FR2.2, NFR1, US2.2, AC2.2.4]

  # ---------- BR10: おまかせ・外で探す ----------
  - id: BR10.16
    statement: 「おまかせ」は、絞り込みなしで、保存した項目から 1 件をランダムに出す。ただし、嫌いな食材の除外は必ず適用する。パスした料理と「選んだもの」は、おまかせの対象から外さない。
    category: policy
    applies_to: [Dish]
    trigger: 「おまかせ」の操作
    logic: "対象 = グループの削除済みでない料理（初期データを含む）のうち、BR10.8 で外されないもの。絞り込みの条件・見た料理の一覧・「選んだもの」は使わない。順番はランダム。IF 対象が 0 件 THEN BR10.20 の案内を出す（保存が 0 件なら、U1 BR4.4 の案内）。おまかせで出した料理にも、「これにする」「パス」ができる（U1 BR4.6）"
    violation: "なし"
    source: [FR2.7, US2.5, AC2.5.1]
    decision: Q5 A
  - id: BR10.17
    statement: 「外で探す」は、YouTube の検索画面を開く。検索語は、選んでいる気分のタグと調理時間の言葉に、「レシピ」を足したものにする。
    category: policy
    applies_to: [Dish]
    trigger: 「外で探す」の操作
    logic: "検索語 = 選んでいる気分のタグ（選んだ順）、調理時間の言葉（「15 分以内」「30 分以内」「それ以上」のどれか。選んでいれば）、「レシピ」を、空白で区切って並べたもの。何も選んでいなければ「レシピ」だけ。手間は検索語に入れない。検索語は、URL として安全な形に変換して渡す（記号などで検索の宛先が変わらないようにする）。検索の画面は新しいタブで開き、このアプリの情報は渡さない（U1 BR3.3 と同じ）"
    violation: "なし"
    source: [FR2.7, US2.5, AC2.5.2]
    decision: Q5 A
  - id: BR10.18
    statement: 「外で探す」で、このアプリが検索結果を取り込むことはしない。検索の画面を開くだけ。
    category: constraint
    applies_to: [Dish]
    trigger: 「外で探す」の操作
    logic: "検索の結果の読み取り、保存、表示をしない。外部のサービスを呼び出す処理は持たない（利用者の端末が、検索の画面を開くだけ）"
    violation: "（設計の制約。違反は設計の欠陥として扱う）"
    source: [FR2.7, FR8, US2.5, AC2.5.3]

  # ---------- BR10: 0 件のときの案内 ----------
  - id: BR10.19
    statement: 絞り込みの結果が 0 件のときは、絞り込みを緩めるよう案内する。
    category: policy
    applies_to: [Dish]
    trigger: 候補の取得（絞り込みを指定している）
    logic: "IF 絞り込みを指定していて、除外（BR10.8）と絞り込み（BR10.11）を適用した後の料理が 0 件（見た料理と「選んだもの」を引く前の数）THEN 「条件に合う料理がありません。絞り込みを緩めてみてください」と表示し、「条件を変える」「おまかせ」「外で探す」を出す。IF 該当する料理はあるが、すべて見た・選んだ THEN これは「見終えた」（U1 BR4.5）であって、この案内ではない"
    violation: "なし"
    source: [FR2.2, US2.4, AC2.4.2]
    decision: Q4 A
  - id: BR10.20
    statement: 好き嫌いの除外のせいで、候補がすべて外れたときは、嫌いな食材の見直しを案内する。
    category: policy
    applies_to: [Dish]
    trigger: 候補の取得、おまかせ（絞り込みを指定していない）
    logic: "IF 絞り込みを指定しておらず、グループの削除済みでない料理が 1 件以上あるのに、除外（BR10.8）で 0 件になった THEN 「登録された嫌いな食材で、候補がすべて外れています。好き嫌いの登録を見直せます」と表示し、好き嫌いの画面への入口を出す（誰の登録かは示さない）。保存が 0 件のときは、U1 BR4.4 の案内。絞り込みを指定していて 0 件のときは、BR10.19"
    violation: "なし"
    source: [FR2.2, FR4.2]
    decision: Q4 A

  # ---------- BR10: 出来事の受け口・入口・拡張点 ----------
  - id: BR10.21
    statement: 「メンバーが抜けた」（household.member-left）出来事を受けたら、そのメンバーの嫌いな食材を、すべて消す。
    category: policy
    applies_to: [DislikedIngredient]
    trigger: household.member-left の受信
    logic: "THEN householdId・memberId が一致する DislikedIngredient をすべて消す。U1 の出来事はアプリ内の呼び出しで、再送も eventId もない。呼び出しは 1 回きりで、受け口は何度呼ばれても結果が同じになる作りにする（対象が 0 件でも成功）。消した後の除外一覧は、BR10.6 により、その人の分を含まない。この受け口は U2 が作る（U7 は出す側）"
    violation: "処理に失敗しても再送されない（送り手にも影響しない）。登録が残っても、BR10.6 が現在のメンバーの登録だけで除外一覧を作るので、除外が過剰にならない。残った行は、あとから消えなくても実害はない"
    source: [FR4.1, FR7.3, ADR-007, AC7.3.1]
  - id: BR10.22
    statement: 「グループが削除された」（household.deleted）出来事を受けたら、そのグループの嫌いな食材を、すべて消す。
    category: policy
    applies_to: [DislikedIngredient]
    trigger: household.deleted の受信
    logic: "THEN householdId が一致する DislikedIngredient をすべて消す。U1 の出来事はアプリ内の呼び出しで、再送も eventId もない。何度呼ばれても結果は同じ。他のグループの登録は変えない。暫定の案（1st バージョンのあとで見直す。components.md）"
    violation: "処理に失敗しても再送されない。削除されたグループには誰も入れないので、残った行は実害がない（BR10.23 で他のグループからは見えない）"
    source: [FR7.6, ADR-007, AC7.5.1]
  - id: BR10.23
    statement: 好き嫌いのすべての読み書きと、除外・絞り込みの判定は、ログイン中の人が所属するグループの範囲に限る。グループは画面の入力ではなく、ログイン状態から決める。
    category: authorization
    applies_to: [DislikedIngredient, Dish]
    trigger: すべての U2 のリクエスト（登録、削除、一覧、除外一覧の問い合わせ、候補、おまかせ、件数）
    logic: "householdId は入口で決めた値だけを使い、リクエストの URL や本文では受け取らない。受け側（Taste）は、渡された householdId で必ず絞る。他のグループの dislikeId や dishId を渡しても、何も返らない・何も変わらない（「見つからない」。U1 BR2.3、BR2.4 と同じ）"
    violation: "「未ログイン」の拒否、または「見つからない」"
    source: [NFR3, ADR-005]
  - id: BR10.24
    statement: 好き嫌いの画面には、「好き嫌いの登録は、アレルギーを防ぐものではありません」と表示する。
    category: policy
    applies_to: [DislikedIngredient]
    trigger: 好き嫌いの画面の表示
    logic: "常に表示する。登録に「アレルギー」の区別や、「絶対に出さない」という保証の表現を入れない。表記ゆれ（「海老」「エビ」）が外れないことも、登録の画面で伝える（「食材名は、材料に書かれた文字のとおり入力してください」）"
    violation: "なし"
    source: [FR13, US4.2, US4.3]
    decision: Q6 A
  - id: BR10.25
    statement: 候補の提案（Suggestion）は、除外する食材の一覧を、窓口 TasteExclusion を通して好き嫌い（Taste）に聞く。一覧が取れなかったときは、候補を出さない。
    category: policy
    applies_to: [Suggestion, DislikedIngredient]
    trigger: 候補の取得、おまかせ、該当件数の計算
    logic: "窓口 TasteExclusion.listExcludedIngredients を、確認済みの householdId つきで呼ぶ。U1 には TasteExclusion の窓口も既定の実装もないので、U2 の作業として、(a) 窓口 TasteExclusion の新設、(b) 既定の実装（空の除外を返す。Taste が使えない場面の土台）と本物の実装（BR10.6）、(c) nextCandidate への絞り込み条件・除外の追加、(d) 該当件数とおまかせの入口の新設、を行う。呼び出しは再試行しない（C2 の決まり）。IF 呼び出しが失敗 THEN 除外なしの候補を出さず、失敗をそのまま上へ返す（食べられないものが出るより、出さないほうを選ぶ）。除外の判定そのものは、候補の提案が 1 か所で行う（ADR-002）"
    violation: "候補の画面には、「うまく読み込めませんでした。もう一度試してください」を出す"
    source: [FR2.2, FR4.2, ADR-002, ADR-004]
```

## ルールの概要

| グループ | ルール | 内容 |
|---|---|---|
| 登録・削除 | BR10.1〜BR10.5 | 1〜50 文字、二重登録なし、50 件まで、削除は本人だけ、一覧は自分の分だけ |
| 除外の判定 | BR10.6〜BR10.9 | グループ全員の一覧、部分一致で正規化なし、候補・おまかせ・件数に適用、材料未入力は出して明示 |
| 絞り込み | BR10.10〜BR10.15 | 3 種類の条件、AND と OR の組み合わせ、30 分以内は累積、未指定は全項目、件数表示、画面が条件を持つ、横スクロールなし |
| おまかせ・外で探す | BR10.16〜BR10.18 | 除外だけ適用、YouTube 検索画面を開くだけ |
| 0 件の案内 | BR10.19〜BR10.20 | 絞り込み 0 件は緩める案内、除外で全部外れたら登録の見直しの案内 |
| 出来事・入口・拡張点 | BR10.21〜BR10.25 | 抜けた・削除の受け口、グループの範囲、アレルギーではない表示、除外一覧が取れなければ出さない |

## 確定事項（レビュー指摘への対応）

- 調理時間は U1 実装の名前（`over30`、項目名は `cookTime`）を正とする。契約 C1・C2 の `longer`／`cookTimeBand` は、U2 のコード生成のときに contract-summary を `over30`／`cookTime` に直す後続作業とする（SuggestionJudge の filter も同様。U4 に食い違いを持ち越さない）。
- 条件に合う件数（BR10.13）と気分のタグの選択肢（BR10.10）を返す窓口は契約 C1 にない。U2 のコード生成で、窓口と contract-summary に足す。
- 出来事は U1 のアプリ内の呼び出しで、再送も eventId もない。取りこぼしの手当ては BR10.6（現在のメンバーの登録だけで除外一覧を作る）で今の設計で決めた。

## 補足

- 除外と絞り込みを適用する順序は、次のとおり：(1) グループの削除済みでない料理 → (2) 除外（BR10.8）→ (3) 絞り込み（BR10.11）→ (4) U1 の「選んだもの」と見た料理を引く（U1 BR4.1、BR4.5）→ (5) ランダムに 1 件。件数（BR10.13）と 0 件の判定（BR10.19）は (3) までで数える。
- 献立（U4）が使う除外の判定（AC4.1.2 の「献立」の部分）は、候補の提案（SuggestionJudge）が同じ判定を提供する。U4 の機能設計で扱う。
- HTTP の状態番号は、Contract Design（C1）の担当であり、ここでは「入力エラー」「未ログイン」「見つからない」の言葉で書く。
