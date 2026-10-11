# 業務ルール：U1 最小の通し版

「こういうときは、こうする」という決めごとです。正（source of truth）は下の yaml ブロックです。ルール番号は `BR{グループ}.{連番}`（BR1 = ログイン、BR2 = グループ、BR3 = 料理、BR4 = 候補の提案）です。

## 根拠（Sources）

- [Q1〜Q12] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` U1 の節
- [memory] ADR-005（リクエストの入口の所属確認）、ADR-007（出来事は at-least-once、重複しても安全）、ADR-008（料理は論理削除）、ADR-009（ID のみで参照）

## ルールの定義

```yaml
rules:
  # ---------- BR1: アカウントとログイン ----------
  - id: BR1.1
    statement: パスワードは 8 文字以上にする。文字の種類の指定はしない。
    category: validation
    applies_to: [Account]
    trigger: アカウント登録
    logic: "IF パスワードが 8 文字未満 THEN 登録しない"
    violation: "「パスワードは 8 文字以上にしてください」と表示し、入力を残す"
    source: [FR7.1, NFR3]
    decision: Q1 A
  - id: BR1.2
    statement: メールアドレスは形式を確認し、大文字小文字を区別せず、全アカウントで重複させない。
    category: validation
    applies_to: [Account]
    trigger: アカウント登録
    logic: "IF 形式が正しくない THEN 登録しない。IF 同じメールアドレス（大文字小文字を無視）が登録済み THEN 登録しない"
    violation: "形式エラーは「入力エラー」、重複は「競合」として扱う。重複時は「登録できません」と表示する（登録済みかどうかを第三者に教えすぎない文言にする）。同時に同じメールアドレスの登録が 2 件来ても、最終的に 1 件だけが成り立つ（一意性を守る）。表示名（1〜50 文字、空なら「メールアドレスの @ より前」）も同じ入力エラーで確認する"
    source: [FR7.1, NFR3]
  - id: BR1.3
    statement: パスワードは元の文字列を保存せず、復元できない形で保存する。
    category: constraint
    applies_to: [Account]
    trigger: アカウント登録
    logic: "保存するのは passwordDigest のみ。ログイン時は入力を同じ方法で変換して比べる"
    violation: "（保存の仕組みの制約。違反は設計の欠陥として扱う）"
    source: [NFR3]
  - id: BR1.4
    statement: 登録に成功したら、そのままログイン状態にする。メールの確認は求めない。
    category: policy
    applies_to: [Account, LoginSession]
    trigger: アカウント登録の成功
    logic: "THEN LoginSession を発行し、グループ作成の画面へ進める"
    violation: "なし"
    source: [FR7.1]
    decision: Q3 A
  - id: BR1.5
    statement: ログイン状態は 30 日間続く。ログアウトするとすぐ終わる。推測できない値で管理する。
    category: policy
    applies_to: [LoginSession]
    trigger: ログイン、ログアウト、各リクエスト
    logic: "IF expiresAt を過ぎている、またはログアウト済み THEN 無効として扱う"
    violation: "「未ログイン」として扱い、ログイン画面へ案内する"
    source: [FR7.1, NFR3]
    decision: Q2 A
  - id: BR1.6
    statement: ログインはメールアドレスとパスワードの組で確認する。失敗の理由（どちらが違うか）は教えない。
    category: validation
    applies_to: [Account]
    trigger: ログイン
    logic: "IF 組が一致しない THEN ログインしない。回数による制限は U1 では行わない（U7）"
    violation: "「メールアドレスまたはパスワードが違います」と表示する（「認証エラー」）"
    source: [FR7.1, NFR3]

  # ---------- BR2: 家族グループ ----------
  - id: BR2.1
    statement: 1 人が入れるグループは 1 つだけ。
    category: constraint
    applies_to: [Member]
    trigger: グループ作成
    logic: "IF leftAt が空の Member をすでに持っている THEN 新しいグループを作らない"
    violation: "「競合」として扱い、「すでにグループに入っています」と表示する。同じ人が同時に 2 つのグループを作ろうとしても、成り立つのは 1 つだけ（一意性を最終的に守る）"
    source: [FR7.2]
    decision: Q4 A
  - id: BR2.2
    statement: グループを作ると、作った人が最初のメンバーになり、「グループが作られた」出来事（household.created）が出る。初期データ 30 件は、その出来事を受けた料理（Dish）が登録する（契約 C3、ADR-007）。
    category: policy
    applies_to: [Household, Member, Dish]
    trigger: グループ作成
    logic: "THEN Household と Member（作った人）を 1 つの処理として作り、成功したあとに household.created を出す。出来事を出すのは、グループ作成が確定したあと。初期データの登録は BR3.12"
    violation: "Household と Member は、どちらかだけが残る状態にしない（失敗したら両方取り消す）。初期データの登録が遅れる・失敗しても、グループ作成は取り消さない。ホームを開いたとき、初期データが 30 件そろっていなければ BR3.12 の補完を行ってから表示する"
    source: [FR7.2, FR12.1, ADR-007]
  - id: BR2.6
    statement: グループ名は 1〜50 文字（空なら「わが家」）にする。
    category: validation
    applies_to: [Household]
    trigger: グループ作成
    logic: "IF 50 文字を超える THEN 作らない"
    violation: "「入力エラー」"
    source: [FR7.2]
  - id: BR2.3
    statement: すべての共有データの読み書きは、ログイン中の人が所属するグループの範囲に限る。グループは画面の入力ではなく、ログイン状態から決める。
    category: authorization
    applies_to: [Household, Dish, PickedItem]
    trigger: すべての業務リクエスト
    logic: "IF 未ログイン THEN 拒否する。IF グループに入っていない THEN グループ作成の案内を出す。householdId は LoginSession の持ち主の Member（leftAt が空）から決める"
    violation: "「未ログイン」の拒否、またはグループ作成の案内"
    source: [FR7.2, NFR3, ADR-005]
  - id: BR2.4
    statement: 他のグループのデータは、存在しないものとして扱う。
    category: authorization
    applies_to: [Dish, PickedItem]
    trigger: ID を指定した読み書き
    logic: "IF 指定された ID のデータの householdId が自分のグループと違う THEN 「見つからない」ものとして扱う"
    violation: "「見つからない」（他のグループにそのデータがあることを教えない）"
    source: [FR1.4, NFR3, ADR-005]
  - id: BR2.5
    statement: メンバー一覧には、退会したメンバーを「退会したメンバー」と表示する。
    category: policy
    applies_to: [Member]
    trigger: メンバー表示（メンバー一覧、作成者、選んだ人）
    logic: "IF leftAt が空でない、または displayName が空 THEN 名前の代わりに「退会したメンバー」と表示する。表示名は Member が持つので、アカウント削除（U7）で Account を消しても、Dish.createdBy や PickedItem.memberId の表示先は残る。U1 では退会の操作がないので、表示の定義だけを置く"
    violation: "なし"
    source: [FR7.4, ADR-009]

  # ---------- BR3: 料理（保存した項目） ----------
  - id: BR3.1
    statement: URL は http または https で始まる、2000 文字までの文字列にする。
    category: validation
    applies_to: [Dish]
    trigger: 料理の保存、編集
    logic: "IF 先頭が http:// でも https:// でもない、または 2000 文字を超える THEN 保存しない"
    violation: "「URL の形式が正しくありません」と表示する（「入力エラー」）"
    source: [FR1.1, NFR3]
    decision: Q7 A
  - id: BR3.2
    statement: 料理の保存に必要なのは URL と料理名だけ。料理名は 1〜100 文字。
    category: validation
    applies_to: [Dish]
    trigger: 料理の保存
    logic: "IF 料理名が空、または 100 文字を超える THEN 保存しない。他の項目は空でよい"
    violation: "項目ごとのエラー表示（「入力エラー」）"
    source: [FR1.1]
    decision: Q7 A
  - id: BR3.3
    statement: 保存した URL は、元のサービスで開く。このアプリの画面を離れて開き、動画や投稿の内容をこのアプリが取り込むことはしない。
    category: policy
    applies_to: [Dish]
    trigger: 「元の動画・投稿を開く」の操作
    logic: "THEN 新しいタブで URL を開く。開く側から、このアプリの情報が渡らないようにする"
    violation: "なし"
    source: [FR1.1, FR8]
  - id: BR3.4
    statement: 調理時間は「15 分以内 / 30 分以内 / それ以上」、手間は「楽 / ふつう / 頑張れる」から選ぶ。どちらも任意。
    category: validation
    applies_to: [Dish]
    trigger: 料理の保存、編集
    logic: "IF 値が決められた選択肢以外 THEN 保存しない"
    violation: "「入力エラー」"
    source: [FR1.2]
  - id: BR3.5
    statement: 気分のタグは 1 つの料理に 5 個まで、1 つは 1〜20 文字、同じタグは重複させない。材料は 1 行ごとに、材料名（必須、50 文字まで）、分量（30 文字まで）、単位（20 文字まで）。メモは 1000 文字まで。
    category: validation
    applies_to: [Dish, DishIngredient]
    trigger: 料理の保存、編集
    logic: "IF 上限を超える、または材料名が空 THEN 保存しない"
    violation: "項目ごとのエラー表示（「入力エラー」）"
    source: [FR1.2]
    decision: [Q7 A, Q8 A]
  - id: BR3.6
    statement: 詳しい情報が空の料理も、通常の料理として扱い、一覧と候補に出す。
    category: policy
    applies_to: [Dish]
    trigger: 一覧、候補の表示
    logic: "IF 調理時間・手間・タグ・材料・メモが空 THEN 空のまま表示する（材料が空の場合の表示は BR4.8）"
    violation: "なし"
    source: [FR1.2]
  - id: BR3.7
    statement: 同じ URL の料理がすでにグループにある場合は、知らせたうえで、保存するかどうかを利用者が選べる。
    category: policy
    applies_to: [Dish]
    trigger: 料理の保存
    logic: "「同じ URL」は、入力された文字列の完全一致で判定する（末尾のスラッシュ、大文字小文字、http と https の違いは別の URL として扱う）。IF 削除済みでなく、source が user の料理に同じ URL がある THEN 「すでに保存済みです」と、既存の料理名を示す。「それでも保存する」を選んだときだけ保存する。初期データ（source = seed）のダミー URL は、確認の対象外とする"
    violation: "利用者が選ばなければ保存しない（確認のみ。エラーではない）"
    source: [FR1.1]
    decision: Q6 A
  - id: BR3.8
    statement: グループのメンバーなら誰でも、料理を編集・削除できる。初期データの料理も同じ。
    category: authorization
    applies_to: [Dish]
    trigger: 料理の編集、削除
    logic: "IF 自分のグループの料理（BR2.4 を満たす）THEN 保存した人かどうかに関わらず許可する"
    violation: "他のグループの料理は「見つからない」（BR2.4）"
    source: [FR1.4, FR12.4]
    decision: Q11 A
  - id: BR3.9
    statement: 料理の削除は論理削除にする。削除した料理は、一覧にも候補にも出さない。
    category: constraint
    applies_to: [Dish, PickedItem]
    trigger: 料理の削除
    logic: "THEN deletedAt を設定する。削除は確認のあとに行う。料理の削除は、候補の提案（Suggestion）のデータを直接変えない（削除の連鎖を持たない。ADR-008）。削除済みの料理を指す PickedItem は、「選んだもの」を取得するとき除いて返す（データは残り、別の出来事で消えることはない）。同じ削除を繰り返しても結果は同じ"
    violation: "なし"
    source: [FR1.4, ADR-008]
  - id: BR3.10
    statement: お気に入りは、料理が持つ印で、グループで共有する。誰が付けても、全員に同じ印が見える。
    category: policy
    applies_to: [Dish]
    trigger: お気に入りの付け外し
    logic: "THEN isFavorite を切り替える。同じ操作を 2 回行っても、結果が壊れない（付ける操作は「付いた状態にする」）"
    violation: "他のグループの料理は「見つからない」（BR2.4）"
    source: [FR6.1]
    decision: Q10 A
  - id: BR3.11
    statement: お気に入りの一覧は、グループのお気に入りの料理（削除済みを除く）を出す。
    category: policy
    applies_to: [Dish]
    trigger: お気に入り一覧の表示
    logic: "isFavorite が true で、deletedAt が空の料理を出す"
    violation: "なし"
    source: [FR6.1]
  - id: BR3.12
    statement: 新しいグループには、データファイルにある初期データ 30 件を、グループごとの料理として複製する。料理（Dish）が household.created を受けて登録する。ファイルを差し替えれば、プログラムを変えずに内容を入れ替えられる。
    category: policy
    applies_to: [Dish]
    trigger: household.created の受信、およびグループのホームを開いたとき（補完）
    logic: "受信したら、データファイルの各行（seedKey つき）を読み、そのグループの Dish（source = seed、ダミーの URL）として作る。IF 同じ seedKey の料理がそのグループにすでにある（削除済みを含む）THEN 作らない。同じ出来事を何度受けても、結果は同じ（冪等、ADR-007）。ホームを開いたとき、ファイルの seedKey のうち、そのグループに 1 つもない seedKey があれば、不足分を作る（出来事が届かなかった場合の補完）。削除済みの初期データは、利用者が消したものなので、補完で復活させない。複製のあとの編集・削除は、そのグループの中だけに反映される（BR3.8）。ファイルは、30 件で、各行が料理名・調理時間・手間・気分のタグ・材料と分量を持ち、BR3.1〜BR3.5 を満たす形とする"
    violation: "ファイルが読めない、または形が正しくない（件数、必須項目の欠落、BR3.1〜BR3.5 違反）THEN 初期データは登録されない。グループ作成は取り消さない。ホームには「初期データを準備中です」と表示し、保存の入口は使えるようにする。異常は運用者に分かるように記録する。登録の途中で止まった場合、次の補完が不足分だけを作る"
    source: [FR12.1, FR12.2, FR12.3, FR12.4]
    decision: Q5 A
  - id: BR3.13
    statement: 保存の画面は 1 画面で完結する。入力は URL と料理名だけで保存でき、URL を貼り付けて保存する方法も使える。
    category: policy
    applies_to: [Dish]
    trigger: 保存の画面の操作
    logic: "URL と料理名を入力して保存を押すと、その画面だけで保存が完了する。貼り付けた URL は、保存の画面の URL 欄に入る"
    violation: "なし"
    source: [FR1.5, NFR1]
  - id: BR3.15
    statement: 保存した料理の一覧は、自分のグループの削除済みでない料理すべてを、新しく保存・更新した順（updatedAt の新しい順）で出す。誰が保存したかに関わらず、同じグループなら全員に同じ一覧が見える。
    category: policy
    applies_to: [Dish]
    trigger: 一覧の表示
    logic: "対象 = グループの deletedAt が空の料理（初期データを含む）。並び = updatedAt の新しい順。他のグループの料理は含めない（BR2.3）"
    violation: "なし"
    source: [FR1.1, FR1.4]
  - id: BR3.14
    statement: 保存の画面には、3 つの入口から入れる。(1) 主な画面の右下の「＋」、(2) 「買い物前」の「貼り付けて保存」（クリップボードの URL を入れた状態で開く）、(3) 他のアプリの共有メニュー（環境が対応している場合のみ。共有された URL を入れた状態で開く）。
    category: policy
    applies_to: [Dish]
    trigger: 保存の画面を開く操作
    logic: "(2)(3) で URL が取れないときは、URL 欄を空にして開く。(3) が使えない環境では (1)(2) だけで保存できる"
    violation: "なし"
    source: [FR1.5, NFR1]

  # ---------- BR4: 候補の提案と「選んだもの」 ----------
  - id: BR4.1
    statement: 候補は、グループの削除済みでない料理のうち、すでに「選んだもの」に入っているものを除いたものから出す。U1 では、絞り込みも好き嫌いの除外も並べ替えもしない。順番はランダム。
    category: calculation
    applies_to: [Dish, PickedItem]
    trigger: 「買い物前」の画面を開く、「最初から見る」
    logic: "対象 = グループの deletedAt が空で、PickedItem がない料理。「最初から見る」でも、選んだものは除く。順番 = ランダム（毎回違う順番になりうる）。初期データの料理も、利用者が保存した料理も、区別せず対象にする"
    violation: "なし"
    source: [FR2.1, FR2.3, FR12.5]
    decision: Q9 A
  - id: BR4.2
    statement: 候補は 1 件ずつ、大きなカードで見せる。見せる内容は、料理名、調理時間、手間、気分のタグ、お気に入りの印、元の動画・投稿を開く入口。
    category: policy
    applies_to: [Dish]
    trigger: 候補の表示
    logic: "画像は U1 では出さず、色の枠で代わりにする（画像は U6）"
    violation: "なし"
    source: [FR2.1]
  - id: BR4.3
    statement: 「パス」した料理は、その見る流れの中では、もう一度出さない。最初から見る（リセット）と、また対象になる。
    category: policy
    applies_to: [Dish]
    trigger: 「パス」の操作
    logic: "パスした料理の ID は、画面（クライアント）が持つ。サーバーは、見た料理の ID の一覧を受け取り、それを除いて次の候補を返す。サーバーはパスの内容を保存しない"
    violation: "なし"
    source: [FR2.1]
  - id: BR4.4
    statement: 保存した料理が 0 件のとき、「まだ保存がありません」と、保存の方法の案内を出す。
    category: policy
    applies_to: [Dish]
    trigger: 「買い物前」の画面を開く
    logic: "IF 対象の料理が 0 件 THEN 案内を出し、保存の画面への入口（BR3.14）を示す。初期データがあるため、通常は起きない（全部削除した場合のみ）"
    violation: "なし"
    source: [FR2.1]
  - id: BR4.5
    statement: すべての料理を見終えたら、見終えたことを表示し、「最初から見る」を選べる。見終えるまで、同じ料理は 2 回出ない。
    category: policy
    applies_to: [Dish]
    trigger: 次の候補の要求
    logic: "IF 見た料理の ID と選んだものを除くと対象が 0 件 THEN 「見終えました」と「最初から見る」を出す。「最初から見る」は見た料理の ID の一覧を空にして、BR4.1 をやり直す"
    violation: "なし"
    source: [FR2.1]
    decision: Q9 A
  - id: BR4.6
    statement: 「これにする」（右スワイプ）で、その料理を「選んだもの」に入れ、次の候補を出す。「選んだもの」は、グループで共有する。
    category: policy
    applies_to: [PickedItem]
    trigger: 「これにする」の操作
    logic: "THEN PickedItem を作る（pickedBy = 操作した人）。次の候補へ進む。見た料理の一覧にも加える（BR4.5）"
    violation: "他のグループの料理、または削除済みの料理は「見つからない」"
    source: [FR2.1, FR2.8]
    decision: Q12 A
  - id: BR4.7
    statement: 同じ料理を「選んだもの」に二重に入れない。同じ操作を繰り返しても、結果は 1 件のまま。
    category: constraint
    applies_to: [PickedItem]
    trigger: 「これにする」の操作
    logic: "IF 同じグループ・同じ料理の PickedItem がすでにある THEN 新しく作らず、成功として返す。2 人が同時に同じ料理を選んでも、PickedItem は 1 件のまま（一意性を最終的に守る）"
    violation: "なし（エラーにしない）"
    source: [FR2.1]
  - id: BR4.8
    statement: 材料が未入力の料理は、候補で「材料が未入力」と明示する。
    category: policy
    applies_to: [Dish]
    trigger: 候補の表示
    logic: "IF ingredients が 0 行 THEN カードに「材料が未入力」と出す"
    violation: "なし"
    source: [FR2.9]
  - id: BR4.9
    statement: ボタン（「これにする」「パス」）だけで、スワイプと同じ操作がすべてできる。
    category: policy
    applies_to: [PickedItem]
    trigger: 候補の操作
    logic: "ボタンの結果は、スワイプの結果（BR4.3、BR4.6）と同じ"
    violation: "なし"
    source: [FR2.1, NFR5]
  - id: BR4.10
    statement: ログイン後のホームから、2 回以内の操作で「買い物前」の画面が開ける。最初の候補は 2 秒以内に出る。
    category: constraint
    applies_to: [Dish]
    trigger: ホーム、「買い物前」の画面を開く
    logic: "ホームに「買い物前」の入口を置く。対象が 200 件以下のとき、最初の 1 件の表示までを 2 秒以内にする"
    violation: "（性能の目標。NFR Requirements で測り方を決める）"
    source: [FR2.1, NFR1]
  - id: BR4.11
    statement: 「選んだもの」から、自分で外せる。外すと、その料理は次に候補を取り直すとき（「最初から見る」、または見終えたあと）に、また候補の対象に戻る（BR4.1）。見ている途中の流れには、割り込まない。
    category: policy
    applies_to: [PickedItem]
    trigger: 「外す」の操作
    logic: "THEN PickedItem を削除する。同じ操作を繰り返しても結果は同じ。買い物リストを作り終えたとき（U3）も、同じように外れる"
    violation: "他のグループのものは「見つからない」（BR2.4）"
    source: [FR2.8]
    decision: Q12 A
```

## ルールの概要

| グループ | ルール | 内容 |
|---|---|---|
| BR1 | BR1.1〜BR1.6 | パスワード 8 文字以上、メールアドレスの重複なし、復元できない形で保存、登録後すぐ使える、30 日のログイン状態 |
| BR2 | BR2.1〜BR2.6 | 1 人 1 グループ、作成時の初期データ、グループの範囲に限る、他のグループは 404、退会したメンバーの表示 |
| BR3 | BR3.1〜BR3.15 | URL と文字数、選択肢、重複 URL の確認、誰でも編集・削除、論理削除、お気に入りの共有、初期データ、保存の入口 |
| BR4 | BR4.1〜BR4.11 | ランダム順、パスは再び出さない、見終えた表示、「選んだもの」、材料未入力の表示、2 回以内の操作・2 秒以内 |

## 補足

- BR2.2 の「出来事」（household.created）は、C3 の契約に従う。受け手は料理（Dish）で、初期データの登録（BR3.12）を行う。出来事は少なくとも 1 回届き、順序は保証されないので、受け手は冪等に作り、届かなかった分は、ホームを開いたときに補う。
- HTTP の状態番号は、Contract Design（C1）の担当であり、ここでは「入力エラー」「未ログイン」「認証エラー」「見つからない」「競合」の言葉で書く。
- BR4.10 の「2 秒」は、性能の目標であり、測り方と合格の基準は NFR Requirements で決める。
