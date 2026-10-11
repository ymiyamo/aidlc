# 業務ルール：U5 作った記録（cook-log）

「こういうときは、こうする」という決めごとです。正（source of truth）は下の yaml ブロックです。ルール番号は `BR40.{連番}`（BR40 = 作った記録）です。U1 の BR1〜BR4 と重ならないようにしています。

## 根拠（Sources）

- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` U5 の節、`stories.md` の US6.2〜US6.6
- [memory] ADR-005（リクエストの入口の所属確認）、ADR-006（作った記録が最新の感想を持つ）、ADR-007（出来事は at-least-once、重複しても安全）、ADR-008（料理は論理削除）、ADR-009（ID のみで参照）
- [scope] `contract-summary.md`（C1 の `/dishes/{dishId}/records`、`/records`、`/records/{recordId}`、エラーコード、C2 の CookLogImpression、C3 の household.deleted）
- [scope] U1 の `rules.md`（BR2.3、BR2.4、BR2.5、BR3.8、BR3.9、BR4.1）

## ルールの定義

```yaml
rules:
  # ---------- BR40: 作った記録 ----------
  - id: BR40.1
    statement: 「作った日」は必須で、実在する日付にする。日本時間の今日まで選べ、未来の日付は選べない。過去は遡れる範囲に上限を設けない。
    category: validation
    applies_to: [CookRecord]
    trigger: 記録の追加、編集
    logic: "IF cookedOn が空、または実在しない日付 THEN 保存しない。IF cookedOn が日本時間の今日より後 THEN 保存しない。画面の日付の選択も、今日までしか選べないようにする（サーバーでも必ず確認する）"
    violation: "未来の日付は「未来の日付は選べません」（FUTURE_DATE_NOT_ALLOWED）、その他は「入力エラー」。入力は残す"
    source: [FR6.2, FR6.7]
    decision: Q6 A
  - id: BR40.2
    statement: 感想は「また作りたい」「もう作りたくない」の 2 択で、選ばなくてもよい。
    category: validation
    applies_to: [CookRecord]
    trigger: 記録の追加、編集
    logic: "IF 感想が空 THEN 「感想なし」として保存する。IF 値が 2 択以外 THEN 保存しない。編集で感想を外す（空に戻す）こともできる"
    violation: "「入力エラー」"
    source: [FR6.2]
  - id: BR40.3
    statement: 料理中の注意点のメモは任意で、自由に入力できる。1000 文字まで。
    category: validation
    applies_to: [CookRecord]
    trigger: 記録の追加、編集
    logic: "IF 1000 文字を超える THEN 保存しない。空でもよい。前後の空白だけのメモは空として扱う"
    violation: "「入力エラー」（項目ごとのエラー表示）"
    source: [FR6.2]
  - id: BR40.4
    statement: 同じ料理の同じ日の記録は、二重に登録しない。すでにあるときは、その旨を知らせ、既存の記録の編集を案内する。
    category: constraint
    applies_to: [CookRecord]
    trigger: 記録の追加、編集（日付を変えるとき）
    logic: "IF 同じグループ・同じ料理・同じ作った日（編集のときは自分自身を除く）の記録がすでにある THEN 保存しない。同時に 2 件の追加が来ても、成り立つのは 1 件だけ（一意性を最終的に守る）。違う料理なら、同じ日に何件でも登録できる"
    violation: "「競合」（DUPLICATE_RECORD）として扱い、「この日の記録がすでにあります」と表示し、既存の記録の編集への入口を示す（既存の記録の recordId を答えに含める）"
    source: [FR6.8]
    decision: [Q1 A, Q2 A]
  - id: BR40.5
    statement: 記録を追加できるのは、自分のグループにあり、削除済みでない料理だけ。
    category: authorization
    applies_to: [CookRecord, Dish]
    trigger: 記録の追加
    logic: "IF 指定された dishId の料理が、自分のグループにない、または他のグループのもの、または削除済み THEN 追加しない。料理の存在は、料理の窓口（DishCatalog.exists）で確かめる。householdId は、入力ではなくログイン状態から決める"
    violation: "「見つからない」（他のグループの料理があることは教えない。BR2.4 と同じ）"
    source: [FR6.2, FR6.8, NFR3.2, ADR-005, ADR-008]
  - id: BR40.6
    statement: 項目の詳細から「作った日を追加」を押すと、作った日（初期値は今日）を選ぶパネルが開く。作った日、感想（任意）、メモ（任意）を入れて保存すると、その日の記録として保存される。同じ項目に何回でも追加できる。
    category: policy
    applies_to: [CookRecord]
    trigger: 項目の詳細の「作った日を追加」
    logic: "パネルの初期値 = 日本時間の今日。保存時に BR40.1〜BR40.5 を確認する。成功したら CookRecord を作る（memberId = 操作した人）。同じ料理の記録は、何件あっても追加できる（件数の上限は設けない）。保存後は、項目の詳細の一覧を更新する"
    violation: "BR40.1〜BR40.5 の違反のとおり"
    source: [FR6.2]
  - id: BR40.7
    statement: 項目の詳細に、その料理を作った回数と、作った日の一覧（作った日の新しい順、各回の感想とメモ）を出す。
    category: calculation
    applies_to: [CookRecord, Dish]
    trigger: 項目の詳細を開く、記録の追加・編集・削除のあと
    logic: "回数 = 自分のグループの、その料理の CookRecord の件数。一覧 = その CookRecord を cookedOn の新しい順に並べたもの（同じ料理の同じ日は 1 件なので、順番は一意）。記録が 0 件のときは「まだ作った記録がありません」と、追加への入口を出す"
    violation: "他のグループの料理は「見つからない」（BR2.4）"
    source: [FR6.3]
  - id: BR40.8
    statement: 記録の作った日、感想、メモは、あとから直せる。保存すると新しい内容に置き換わる。
    category: policy
    applies_to: [CookRecord]
    trigger: 記録の編集
    logic: "編集で変えられるのは cookedOn・impression・cautionMemo だけ。BR40.1〜BR40.4 を確認する（BR40.4 は自分自身を除く）。成功したら置き換え、updatedAt を更新する。dishId・memberId・createdAt は変えない。同じ内容で保存し直しても結果は同じ"
    violation: "BR40.1〜BR40.4 の違反のとおり。他のグループの記録は「見つからない」（BR40.10）"
    source: [FR6.9]
  - id: BR40.9
    statement: 記録の削除は、確認のあとに行う。削除するのはその 1 件だけで、同じ料理の他の記録は残る。
    category: policy
    applies_to: [CookRecord]
    trigger: 記録の削除
    logic: "確認の画面で「削除する」を選んだときだけ、その CookRecord を消す（物理削除）。カレンダー、一覧、項目の詳細の表示と、最新の感想（BR40.19）は、削除のあとの状態になる。すでに無い記録を重ねて削除しても、結果は同じ（記録がない状態）"
    violation: "他のグループの記録は「見つからない」（BR40.10）。確認で「やめる」を選んだら何も変えない"
    source: [FR6.9]
  - id: BR40.10
    statement: 記録の読み書きは、自分のグループの範囲に限る。グループのメンバーなら、誰でも記録を編集・削除できる。
    category: authorization
    applies_to: [CookRecord]
    trigger: 記録に関するすべてのリクエスト
    logic: "householdId はログイン状態から決める（BR2.3）。IF 指定された recordId の記録の householdId が自分のグループと違う THEN 「見つからない」ものとして扱う。自分のグループの記録は、記録した人（memberId）かどうかに関わらず、編集・削除を許可する（BR3.8 と同じ）"
    violation: "「見つからない」（他のグループにその記録があることを教えない。ADR-005）、未ログインは拒否"
    source: [FR6.9, NFR3.2, ADR-005]
    decision: Q5 A
  - id: BR40.11
    statement: 料理が削除（論理削除）されても、その料理の記録は残す。記録には料理名を出し、「削除済み」と添える。削除済みの料理には、新しく記録を追加できない。
    category: constraint
    applies_to: [CookRecord, Dish]
    trigger: 料理の削除、記録の表示
    logic: "料理の削除は CookRecord に手を加えない（削除の連鎖を持たない。ADR-008）。表示の料理名は、料理の窓口（DishCatalog.getMany。削除済みも含めて返す）で一括して取る。IF 料理が削除済み THEN 料理名のあとに「（削除済み）」を添える。削除済みの料理の既存の記録は、編集・削除できる。追加は BR40.5 で断る。記録のカレンダーと一覧の件数は、削除済みの料理の記録も数える"
    violation: "なし（表示の定義）"
    source: [FR6.2, ADR-008, ADR-009]
    decision: Q3 A
  - id: BR40.12
    statement: カレンダーの各日に、その日に作った料理名（短く）と感想の印を出す。1 日に複数あるときは、複数あることが分かる表示にする。
    category: calculation
    applies_to: [CookRecord, Dish]
    trigger: 記録の画面でカレンダーを開く、月を切り替える
    logic: "月の各日について、その日の CookRecord を集める。料理名は 8 文字までで、超える分は「…」で省く（短く）。感想の印は、また作りたい（`again`）、もう作りたくない（`never_again`）、感想なしで 3 通りに分ける。IF その日の記録が 2 件以上 THEN 先頭の 1 件の料理名のあとに「ほか N 件」を付けるなど、件数が分かる表示にする（先頭は createdAt の新しいもの）。日をタップしなくても内容が見える"
    violation: "なし"
    source: [FR6.5]
  - id: BR40.13
    statement: カレンダーの下に、その月の記録を一覧で出す。記録の画面では「一覧」と「カレンダー」を切り替えられる。どちらも、同じ月の同じ記録を表示する。
    category: policy
    applies_to: [CookRecord]
    trigger: 記録の画面を開く、「一覧」「カレンダー」の切り替え、月の切り替え
    logic: "月の一覧 = その月（日本時間）の自分のグループの CookRecord を、cookedOn の新しい順に並べたもの（同じ日は createdAt の新しい順）。各行は、作った日、料理名、感想の印、メモ。初期の表示は今月のカレンダー。月は前後に切り替えられる。記録のない月は「この月の記録はありません」と出す。過去の月は、さかのぼって見られる"
    violation: "なし"
    source: [FR6.3, FR6.5]
  - id: BR40.14
    statement: カレンダーの日をタップすると、その日の記録の一覧（料理、感想、注意点メモ）と、「作ったものを追加」ボタンが出る。記録のない日でも出る。
    category: policy
    applies_to: [CookRecord]
    trigger: カレンダーの日のタップ
    logic: "その日の CookRecord を、createdAt の新しい順に出す。0 件なら「この日の記録はありません」と出す。「作ったものを追加」ボタンは、常に置く（未来の日は BR40.15）。各記録から、編集と削除に進める（BR40.8、BR40.9）"
    violation: "なし"
    source: [FR6.6]
  - id: BR40.15
    statement: カレンダーの日付から「作ったものを追加」を押すと、項目を選ぶ画面が開く。未来の日付では追加できず、今日までの日付のみと表示する。
    category: validation
    applies_to: [CookRecord]
    trigger: 「作ったものを追加」の操作
    logic: "IF タップした日が日本時間の今日より後 THEN ボタンを押せない状態にして「追加できるのは今日までの日付です」と表示する（サーバーでも BR40.1 で断る）。それ以外は、その日を作った日として、項目を選ぶ画面（BR40.16）を開く"
    violation: "未来の日付は「未来の日付は選べません」（FUTURE_DATE_NOT_ALLOWED）"
    source: [FR6.6, FR6.7]
  - id: BR40.16
    statement: 項目を選ぶ画面では、保存した項目（初期データを含む）を、料理名で絞り込める。「最近選んだもの」「お気に入り」「すべて」を切り替えられる。
    category: policy
    applies_to: [Dish]
    trigger: 項目を選ぶ画面の操作
    logic: "対象 = 自分のグループの、削除済みでない料理（初期データを含む）。料理名の絞り込みは、入力した文字列を含むものを出す（大文字小文字を区別せず、前後の空白は無視する。空なら絞り込まない）。「すべて」= 対象すべて。「お気に入り」= isFavorite が true の料理（BR3.11）。「最近選んだもの」= 現在の「選んだもの」（PickedItem）にある料理。作った記録（CookLog）は候補の提案（Suggestion）を呼ばない。画面が「選んだもの」の一覧（U1）を取り、対象と突き合わせる。この 3 つの切り替えと文字列の絞り込みは、重ねて使える。該当がなければ「該当する項目がありません」と出す"
    violation: "なし"
    source: [FR6.6]
    decision: Q6 A
  - id: BR40.17
    statement: 項目を選んだら、感想とメモ（どちらも任意）を入れて保存する。その日の記録として追加され、カレンダーのその日に料理名と感想の印が出る。同じ日に、別の項目を続けて追加でき、同じ日に複数の記録が並ぶ。
    category: policy
    applies_to: [CookRecord]
    trigger: 項目を選んだあとの「保存」
    logic: "保存時に BR40.1〜BR40.5 を確認する。成功したら CookRecord を作り（memberId = 操作した人）、カレンダーと日の一覧を更新する。同じ日に別の項目を追加することは、いつでもできる。同じ日の同じ項目は BR40.4 で断る"
    violation: "BR40.1〜BR40.5 の違反のとおり"
    source: [FR6.6, FR6.8]
  - id: BR40.18
    statement: 作ったものが保存した項目にないときは、項目を選ぶ画面から、料理を「保存する」画面へ案内する。
    category: policy
    applies_to: [Dish]
    trigger: 項目を選ぶ画面で、探しても見つからない
    logic: "項目を選ぶ画面に、常に「見つからないときは、新しく保存する」の入口を置く。押すと U1 の保存の画面（BR3.13、URL と料理名で保存）へ進む。保存したあと、項目を選ぶ画面（同じ日付）に戻り、保存した料理を選べるようにする。保存の画面の仕様と、URL を必須とするかどうか（OQ11）は U1 の担当で、このユニットは変えない"
    violation: "なし"
    source: [FR6.6]
  - id: BR40.19
    statement: 料理ごとの「最新の感想」は、作った日が最も新しい記録 1 件の感想とする。その記録に感想がなければ「感想なし」とする。記録が 1 件もない料理も「感想なし」とする。
    category: calculation
    applies_to: [CookRecord]
    trigger: 最新の感想の問い合わせ（契約 C2 の CookLogImpression.latestImpressionsByDish）
    logic: "入力 = 呼び出し元が確認済みの householdId と、料理の ID の一覧。出力 = 料理の ID → `again` / `never_again` / `none` の対応表。料理ごとに、cookedOn が最も新しい CookRecord を 1 件選び（同じ料理の同じ日は 1 件なので、一意）、その impression を答える。以前の記録の感想にはさかのぼらない。記録の追加・編集・削除のあとの問い合わせには、その結果が反映される。料理の一覧をまとめて渡し、料理ごとの問い合わせはしない（一括）。渡された householdId の記録にしか届かない。無い料理の ID や他のグループの ID は、`none` として答える"
    violation: "なし"
    source: [FR6.4, ADR-006, ADR-005]
    decision: Q4 A
  - id: BR40.20
    statement: 最新の感想が「もう作りたくない」の料理は、候補の提案で、記録のない料理・最新の感想が「また作りたい」または感想なしの料理より後ろに出す。最新の記録が優先され、以前は「もう作りたくない」でも最新が「また作りたい」ならずらさない。
    category: policy
    applies_to: [Dish, CookRecord]
    trigger: 候補の提案（U1 の BR4.1。契約 C2 の SuggestionJudge.pickCandidates）
    logic: "U1 の候補（削除済みでなく、選んだものでない料理）に対して、BR40.19 で最新の感想を一括で聞く。並べ替え = 安定な分け方：`never_again` でない料理を前、`never_again` の料理を後ろにする。それぞれの中の順番は、U1 の順番（ランダム）のまま変えない。`never_again` の料理も候補から外さない（すべての候補を見終えるまでに、いずれは出る）。反映するのは候補の並び順の 1 点のみ（FR6.4）：「おまかせ」の抽選や、感想なしの扱いは変えない。U5 が入っていないとき（既定の実装）は、すべて `none` を返し、並べ替えは起きない"
    violation: "最新の感想を聞けなかったとき（失敗）は、並べ替えをせず U1 の順番のまま候補を出す。候補の表示は止めない"
    source: [FR6.4]
  - id: BR40.21
    statement: グループが削除されたとき、そのグループの記録をすべて消す。
    category: policy
    applies_to: [CookRecord]
    trigger: household.deleted の受信（契約 C3）
    logic: "出来事に含まれる householdId の CookRecord を、すべて物理的に消す。出来事は少なくとも 1 回届き、順序は保証されないので、同じ出来事を何度受けても結果は同じ（冪等、ADR-007）。他のグループの記録には触れない。グループの削除の連鎖は暫定の案で、1st バージョンのあとで見直す"
    violation: "処理が途中で止まったら、次に受け直したとき、残りを消す。消すのが遅れても、そのグループのデータは見えない（BR2.3）"
    source: [FR7.6, ADR-007]
  - id: BR40.22
    statement: 日付は日本時間（Asia/Tokyo）で扱う。「今日」「今月」「月の境目」はすべて日本時間で決める。月を指定する問い合わせは、「年-月」の形にする。
    category: constraint
    applies_to: [CookRecord]
    trigger: 日付に関するすべての判定
    logic: "cookedOn は時刻を持たない日付で、日本時間の暦の日として扱う。「今日までか」の判定（BR40.1、BR40.15）、初期値の今日（BR40.6）、月の範囲（BR40.12、BR40.13）は、日本時間で行う。端末の時刻や時差に左右されない。月の指定は「年-月」（例：2026-10）。形が正しくない、または実在しない月は保存・取得しない。未来の月を見ることはできる（記録は 0 件）"
    violation: "月の形が正しくないときは「入力エラー」"
    source: [FR6.7, C2 の共通規則]
  - id: BR40.23
    statement: 記録に出す「記録した人」は、メンバーの表示名にする。退会したメンバーは「退会したメンバー」と表示する。
    category: policy
    applies_to: [CookRecord, Member]
    trigger: 記録の表示（項目の詳細、カレンダー、一覧、日の一覧）
    logic: "記録は memberId だけを持つ（ADR-009）。表示名は、表示のときに BR2.5 の定義で作る（leftAt が空でない、または displayName が空なら「退会したメンバー」）。表示名を記録に複製して保存しない。メンバーが抜けても、アカウントが削除されても、記録は残る（FR7.5）"
    violation: "なし"
    source: [FR7.5, ADR-009]
```

## ルールの概要

| ルール | 内容 |
|---|---|
| BR40.1〜BR40.3 | 作った日（日本時間の今日まで、過去の上限なし）、感想（2 択・任意）、メモ（1000 文字・任意） |
| BR40.4〜BR40.5 | 同じ日の同じ料理は二重に登録しない（編集でも同じ）、追加できるのは自分のグループの削除済みでない料理 |
| BR40.6〜BR40.9 | 項目の詳細から追加（初期値は今日）、回数と一覧（新しい順）、編集、削除（確認のあと、その 1 件だけ） |
| BR40.10〜BR40.11 | グループの範囲、メンバーなら誰でも編集・削除、料理が削除されても記録は残す（「削除済み」と添える） |
| BR40.12〜BR40.15 | カレンダー（料理名と印、複数の表示）、月の一覧と切り替え、日のタップ、未来の日は追加不可 |
| BR40.16〜BR40.18 | 項目を選ぶ画面（絞り込み、最近選んだもの／お気に入り／すべて）、保存、見つからなければ保存の画面へ |
| BR40.19〜BR40.20 | 最新の感想（最新の記録 1 件）、「もう作りたくない」を候補の後ろにずらす |
| BR40.21〜BR40.23 | グループ削除で記録を消す、日付は日本時間、記録した人の表示 |

## 補足

- HTTP の状態番号は Contract Design（C1）の担当で、ここでは「入力エラー」「未ログイン」「見つからない」「競合」の言葉と、エラーコード（`FUTURE_DATE_NOT_ALLOWED`、`DUPLICATE_RECORD`）で書く。
- BR40.20 は U1 の BR4.1（候補の順番はランダム）を拡張するだけで、U1 のルールは書き換えない。U1 の既定の実装（すべて `none`）を、U5 が本物の実装に差し替える（契約 C2）。
- BR40.16 の「最近選んだもの」の意味は Q6 A による解釈で、承認のときに確認してほしい（`functional-spec.md` の Assumptions & Open Questions を参照）。
