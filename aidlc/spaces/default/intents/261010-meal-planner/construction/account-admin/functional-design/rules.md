# 業務ルール：U7 グループとアカウントの管理（account-admin）

「こういうときは、こうする」という決めごとです。正（source of truth）は下の yaml ブロックです。ルール番号は `BR50.{連番}`（BR50 = U7 のグループ）です。U1 の BR1〜BR4 と重ならないよう、50 番台にしました。

## 根拠（Sources）

- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U7 の節
- [req] FR7.1〜FR7.6、NFR3.1〜NFR3.5
- [memory] ADR-007（出来事は at-least-once、受け手は冪等）、ADR-009（退会メンバーの扱い）、契約 C3、C5
- [assumption] BR50.2「再設定の発行は同じアカウントで 1 時間に 3 回まで」は、Q1〜Q6、NFR3.1、上流の決定のどれにもない数値。設計の判断で置いた。承認のときに確認する。
- [assumption] BR50.19「アカウント削除のパスワード再入力は、連続 5 回まちがえたら 15 分間受け付けない」は、質問にない決定（ログインの制限 BR50.5 と同じ数字に揃えた）。利用者には、削除の操作が一時的にできなくなる形で見える。承認のときに確認する。

## ルールの定義

```yaml
rules:
  # ---------- パスワードの再設定 ----------
  - id: BR50.1
    statement: パスワード再設定の受け付けは、メールアドレスが登録済みかどうかに関わらず、同じ応答を返す。
    category: policy
    applies_to: [Account, PasswordResetToken]
    trigger: 再設定の要求（メールアドレスの入力）
    logic: "THEN 「登録されているメールアドレスなら、案内を送りました」と常に同じ文言で受け付ける。IF 登録済みで削除済みでない THEN BR50.3 のリンクを作り、BR50.25 の窓口に渡す。IF 未登録、または削除済み THEN 何も作らず、何も送らない。ロック中のアカウントでも受け付ける"
    violation: "メールアドレスの形式が明らかに誤りなら「入力エラー」。それ以外は、結果の違いを画面の答えに出さない"
    source: [FR7.1, NFR3, C5]
  - id: BR50.2
    statement: 再設定のリンクの発行は、同じアカウントで 1 時間に 3 回までにする。
    category: constraint
    applies_to: [PasswordResetToken]
    trigger: 再設定の要求
    logic: "IF 直近 1 時間に、同じアカウントで 3 本発行済み THEN 新しく作らず、送らない。応答は BR50.1 と同じ（上限に達したことを教えない）"
    violation: "（応答は変えない。上限超過は運用者に分かる形で記録する。BR50.26 の伏せ字に従う）"
    source: [NFR3]
  - id: BR50.3
    statement: 再設定のリンクは、推測できないランダムな値の変換値だけを保存する。60 分間有効で、1 回だけ使える。新しいリンクを発行すると、前の未使用のリンクは使えなくなる。
    category: constraint
    applies_to: [PasswordResetToken]
    trigger: 再設定のリンクの発行
    logic: "元の値は、十分に長いランダムな値で作り、リンクに入れて窓口へ渡したあとは保存しない（tokenDigest のみ保存）。expiresAt = 発行の 60 分後。同じアカウントの有効なものに invalidatedAt を付けてから、新しいものを作る（同時に有効なのは 1 本）"
    violation: "（保存の仕組みの制約。元の値を保存・記録したら設計の欠陥として扱う）"
    source: [FR7.1, NFR3]
    decision: Q3 A
  - id: BR50.4
    statement: 再設定の確定は、有効なリンクと、8 文字以上の新しいパスワードがそろったときだけ成功する。成功したら、リンクを使用済みにし、すべてのログイン状態を終わらせ、ロックを解く。
    category: validation
    applies_to: [PasswordResetToken, Account, LoginSession]
    trigger: 再設定の確定（リンクを開いて新しいパスワードを入れる）
    logic: "リンクの値を同じ方法で変換して、PasswordResetToken を探す。IF 見つからない、使用済み、無効にされた、期限切れのいずれか THEN 失敗。IF 新しいパスワードが BR1.1 を満たさない THEN 失敗（リンクは使用済みにしない）。成功なら、1 つの処理として次をすべて行う：passwordDigest を新しい変換値に置き換える（BR1.3）、usedAt を付ける、そのアカウントのすべての LoginSession を無効にする、failedLoginCount を 0、lockedUntil を空にする。同時に同じリンクで 2 回確定しても、成功は 1 回だけ。成功したあとは、自動でログインしない（新しいパスワードでログインし直す）"
    violation: "リンクの問題は、理由を区別せず「このリンクは使えません。もう一度、再設定を要求してください」と表示する（「入力エラー」）。パスワードの問題は「パスワードは 8 文字以上にしてください」と表示し、入力を残す"
    source: [FR7.1, NFR3, C1]
    decision: [Q3 A, Q2 A]

  # ---------- ログイン失敗の制限 ----------
  - id: BR50.5
    statement: ログインに 5 回続けて失敗したら、そのアカウントを 15 分間ロックする。ロックはアカウント単位で、失敗の回数とロック解除の時刻を持つ。
    category: constraint
    applies_to: [Account]
    trigger: ログインの失敗（登録済みのメールアドレスで、パスワードが違う）
    logic: "THEN failedLoginCount を 1 増やす（同時に失敗が来ても、数え落とさない）。IF failedLoginCount が 5 に達した THEN lockedUntil = その時点の 15 分後。IF 未登録のメールアドレス THEN 数えない（BR50.8）。ログインの失敗の理由は BR1.6 のとおり教えない"
    violation: "失敗時の文言は BR1.6 と同じ「メールアドレスまたはパスワードが違います」（5 回目まで）"
    source: [FR7.1, NFR3.1]
    decision: Q2 A
  - id: BR50.6
    statement: ロック中は、正しいパスワードでもログインできない。ロックの期限は延びない。
    category: constraint
    applies_to: [Account, LoginSession]
    trigger: ログイン（6 回目以降の試行を含む）
    logic: "IF lockedUntil が現在より後 THEN パスワードを確かめる前に拒否する。failedLoginCount も lockedUntil も変えない。ロック中でも、パスワード再設定の要求と確定はできる（BR50.1、BR50.4）"
    violation: "「ログインの失敗が続いたため、しばらくログインできません（約 15 分）」と表示する（「認証エラー」の一種。ロック解除の時刻は、秒まで教えない）"
    source: [FR7.1, NFR3.1]
    decision: Q2 A
  - id: BR50.7
    statement: ログインに成功したとき、またはロックの期限が過ぎたあとは、失敗の回数を 0 から数え直す。
    category: policy
    applies_to: [Account]
    trigger: ログインの成功、ロック期限の経過後の最初の試行
    logic: "IF ログインに成功 THEN failedLoginCount を 0、lockedUntil を空にする。IF lockedUntil が過去 THEN 試行の前に failedLoginCount を 0、lockedUntil を空にしてから、通常どおり判定する。「続けて」5 回なので、間に成功が入れば数え直す"
    violation: "なし"
    source: [FR7.1, NFR3.1]
  - id: BR50.8
    statement: 未登録のメールアドレスや削除済みのアカウントの失敗は、数えず、ロックも作らない。画面の答えは、登録済みの場合の 5 回目までの失敗と同じにする。
    category: policy
    applies_to: [Account]
    trigger: ログインの失敗（未登録、または削除済み）
    logic: "THEN どのアカウントの回数も変えない。文言は BR1.6 と同じ"
    violation: "なし"
    source: [NFR3]

  # ---------- 招待リンク ----------
  - id: BR50.9
    statement: 招待リンクは、グループのメンバーだけが発行できる。7 日間有効で、同時に有効なものは 1 グループ 10 本まで。発行した直後の画面に 1 度だけ、リンクを表示する。
    category: policy
    applies_to: [Invitation]
    trigger: 招待リンクの発行
    logic: "IF ログイン中でない THEN 拒否（BR2.3）。IF グループに入っていない THEN グループ作成の案内。householdId はログイン状態から決める（BR50.14）。IF 有効な Invitation が 10 本ある THEN 新しく作らない。THEN Invitation を作り（expiresAt = 発行の 7 日後）、リンクを画面に表示する。通し版ではメールを送らず、画面に表示するだけが「共有」の手段（コピーして渡す）"
    violation: "10 本を超える場合は「競合」として「有効な招待リンクがいっぱいです。期限が切れるのを待つか、使われるのを待ってください」と表示する"
    source: [FR7.2, AC7.2.1, NFR3]
    decision: Q4 A
  - id: BR50.10
    statement: 招待リンクは、推測できないランダムな値の変換値だけを保存する。リンクの元の値は、発行の直後の表示以外では出さない。
    category: constraint
    applies_to: [Invitation]
    trigger: 招待リンクの発行、リンクを開く操作
    logic: "元の値は十分に長いランダムな値で作り、保存するのは tokenDigest のみ。開くときは、渡された値を同じ方法で変換して探す。なくしたリンクは再表示できないので、新しく発行する"
    violation: "（保存の仕組みの制約。元の値を保存・記録したら設計の欠陥として扱う）"
    source: [FR7.2, NFR3]
  - id: BR50.11
    statement: 招待リンクを開いた人には、参加する前に、グループ名と、参加できるかどうかを見せる。ログインは参加の操作のときに求める。
    category: policy
    applies_to: [Invitation]
    trigger: 招待リンクを開く
    logic: "IF 有効 THEN グループ名と「参加する」を見せる（メンバーの名前や人数は見せない）。IF 期限切れ（見つかり、usedAt が空で、expiresAt を過ぎた）THEN BR50.13 の表示。IF 見つからない、または使用済み THEN 「このリンクは使えません」と表示する。未ログインで「参加する」を押したら、ログイン（または登録）へ案内し、終わったら参加の確認に戻す"
    violation: "（表示のみ。エラーにしない）"
    source: [FR7.2, AC7.2.2, AC7.2.3]
  - id: BR50.12
    statement: 招待リンクでの参加は、有効なリンクを使う人が、どのグループにも入っていないときだけ成功する。成功したら、グループのメンバーになり、そのリンクは使用済みになる。
    category: constraint
    applies_to: [Invitation, Member]
    trigger: 参加の操作
    logic: "IF ログイン中でない THEN 拒否。IF その人に、leftAt が空の Member がある THEN 参加しない（同じグループでも、別のグループでも。Q5 A）。IF Invitation が有効（usedAt が空で、期限内）THEN 1 つの処理として次を行う：Member を作る（displayName = 参加の画面で入力された表示名。空なら U1 の既定＝メールアドレスの @ より前。joinedAt = 現在）、Invitation に usedAt と usedBy を付ける。同時に 2 人が同じリンクで参加しても、成り立つのは 1 人だけ。同じグループに対する「有効な Member の数の判定」「グループ削除（BR50.22）」「参加による Member の追加」は、1 件ずつ確定する（直列）。グループが削除済み、または削除中なら、参加は「このリンクは使えません」（BR50.11 と同じ表示）成功したあと、共有内容（料理、選んだもの）がすぐ見られる（BR2.3）"
    violation: "すでにメンバーなら「競合」として「先に今のグループから抜けてください」と表示する（リンクは使用済みにせず、そのまま残す）。使われた直後などで無効なら BR50.11 の「使えません」、期限切れなら BR50.13"
    source: [FR7.2, FR7.3, AC7.2.2]
    decision: [Q4 A, Q5 A]
  - id: BR50.13
    statement: 発行から 7 日を過ぎた招待リンクでは参加できない。「再発行が必要です」と表示する。
    category: validation
    applies_to: [Invitation]
    trigger: 期限切れの招待リンクを開く、または参加を押す
    logic: "IF expiresAt が現在以前 THEN 参加させない（開く操作でも、参加の操作でも判定する。画面を開いたまま 7 日を過ぎた場合に備える）。「再発行が必要」とは、グループのメンバーに、新しいリンクを発行してもらうことを指す。期限の判定は、日本時間（Asia/Tokyo）の時刻で扱う（C2 の日付の決まりに合わせる）"
    violation: "「このリンクは期限が切れています。招待した人に、新しいリンクを発行してもらってください」と表示する（契約 C1 では 410）"
    source: [FR7.2, AC7.2.3]
  - id: BR50.14
    statement: 他のグループの招待は使えず、他のグループの招待を操作することもできない。参加先と発行先は、リンクとログイン状態から決め、画面の入力から受け取らない。
    category: authorization
    applies_to: [Invitation, Household]
    trigger: 招待の発行、参照、参加
    logic: "参加先のグループ = 使うリンクの Invitation.householdId のみ。発行先のグループ = ログイン中の人の有効な Member のグループのみ（BR2.3）。画面が householdId を送ってきても、使わない。有効な招待は、そのリンクを知っている人だけが使える（リンクの一覧を見せる画面は作らない）"
    violation: "他のグループに関わる指定は「見つからない」として扱い、存在を教えない（BR2.4）"
    source: [FR7.2, NFR3.2, ADR-005]
  - id: BR50.15
    statement: 一度グループを抜けた人が招待で戻るときは、新しいメンバーとして加える。前のメンバーの行は、退会のまま残す。
    category: policy
    applies_to: [Member]
    trigger: 退会済みの人が、招待で参加する
    logic: "THEN BR50.12 で新しい Member（新しい memberId）を作る。前の Member（leftAt が設定済み）は変えない。前に保存した項目と記録は、「退会したメンバー」の表示のままで、新しい Member には結びつかない"
    violation: "なし"
    source: [FR7.4, ADR-009]
    decision: Q5 A

  # ---------- グループから抜ける ----------
  - id: BR50.16
    statement: グループから抜けられるのは本人だけ。抜けると、そのメンバーは退会になり、名前とアカウントとのつながりが消える。そして「メンバーが抜けた」出来事が出る。
    category: policy
    applies_to: [Member, DomainEventRecord]
    trigger: 「グループから抜ける」の確認
    logic: "IF ログイン中でない THEN 拒否。対象は、ログイン中の人の有効な Member のみ（他の人を抜けさせる操作は作らない）。THEN 1 つの処理として次を行う：leftAt を現在にする、displayName を空にする、accountId を空にする、household.member-left（householdId、memberId）を DomainEventRecord に記録する。記録が確定したあとで配る（BR50.23）。ログイン状態は終わらせない（アカウントは残り、グループ作成か、別の招待で参加できる）。IF すでに退会済み THEN 何もせず成功として返す（冪等）。同じグループについて、退会・「有効な Member の数の判定」・グループ削除（BR50.22）・参加（BR50.12）は 1 件ずつ確定する（直列）。2 人が同時に抜けるときは、あとに確定した人が「他に有効な Member がいない」と判定し、グループを削除する"
    violation: "有効な Member がない場合は、グループ作成の案内（BR2.3）"
    source: [FR7.4, ADR-009, C3]
  - id: BR50.17
    statement: 抜けた人の好き嫌いは、提案の条件から外れる。外す処理は好き嫌い（U2）の受け口が、「メンバーが抜けた」出来事を受けて行う。U7 は出来事を出すだけ。
    category: policy
    applies_to: [DomainEventRecord]
    trigger: household.member-left の配達
    logic: "出来事には householdId と memberId だけを持たせ、好き嫌いのデータには触れない（U7 は他のコンポーネントのデータを直接消さない）。受け口が未完成のユニットは、出来事を受けても何も起きない（U7 は他のユニットに依存しない）。届かなかった場合は BR50.23 の配り直しで届ける"
    violation: "（受け手の失敗は、抜けた操作を取り消さない）"
    source: [FR7.4, AC7.3.1, C3]
  - id: BR50.18
    statement: 抜けても、その人が保存した項目と、その人の記録は、グループに残る。表示は「退会したメンバー」になる。
    category: policy
    applies_to: [Member, Dish, PickedItem]
    trigger: メンバーの退会（抜ける、アカウント削除）
    logic: "U7 は Dish、PickedItem、作った記録に触れない。それらが持つ memberId は残り、Member が退会（leftAt あり、または displayName が空）なので、BR2.5 により「退会したメンバー」と表示される"
    violation: "なし"
    source: [FR7.4, FR7.5, AC7.3.2, AC7.4.2, ADR-009]
  - id: BR50.19
    statement: 「抜ける」と「アカウント削除」は、確認を挟む。最後の 1 人のときは、グループのデータがすべて消えることを明示して、もう一度確認する。アカウント削除は、パスワードの再入力を求める。
    category: validation
    applies_to: [Member, Account]
    trigger: 「抜ける」「アカウントを削除する」の操作
    logic: "「抜ける」：確認画面を出す。有効なメンバーが自分 1 人だけのとき、「あなたが最後のメンバーです。抜けると、グループの料理、記録、献立、買い物リストなどのデータがすべて削除されます」と出し、もう一度確認する。「アカウント削除」：パスワードの再入力が一致したときだけ実行する。パスワードの照合の失敗は、ログインの失敗の回数（BR50.5）には数えない（ログイン済みで確認するだけのため）が、続けて失敗するのを防ぐため、連続 5 回まちがえたらその操作を 15 分間受け付けない"
    violation: "確認しなかった・パスワードが違う場合は、何も変えない。「パスワードが違います」と表示する（「認証エラー」）"
    source: [FR7.4, FR7.5, FR7.6, NFR3]
    decision: Q6 A

  # ---------- アカウント削除 ----------
  - id: BR50.20
    statement: アカウントを削除すると、メールアドレスと、パスワードの変換値と、表示名が消え、そのアカウントでログインできなくなる。そして「アカウントが削除された」出来事が出る。
    category: policy
    applies_to: [Account, LoginSession, PasswordResetToken, DomainEventRecord]
    trigger: アカウント削除の確定（BR50.19 の確認のあと）
    logic: "THEN 1 つの処理として次を行う：email、passwordDigest を空にし（Account は表示名を持たない。Member の表示名は BR50.21 の退会で消える）、deletedAt を現在にする（行は残す。ADR-009）、そのアカウントのすべての LoginSession と PasswordResetToken を消す、DevMailOutbox の記録を消す、account.deleted（accountId）を DomainEventRecord に記録する。記録が確定したあとで配る。メールアドレスは空になるので、同じメールアドレスで新しく登録し直せる（BR1.2）。IF すでに削除済み THEN 何もせず成功として返す（冪等）"
    violation: "（パスワード再入力の失敗は BR50.19）"
    source: [FR7.5, AC7.4.1, NFR3.4, C3]
  - id: BR50.21
    statement: 「アカウントが削除された」出来事を、家族グループの受け口が受けたら、そのアカウントの有効なメンバーを退会にし、「メンバーが抜けた」出来事を出す。最後の 1 人だったら、グループを削除する。
    category: policy
    applies_to: [Member, Household, DomainEventRecord]
    trigger: account.deleted の配達
    logic: "accountId を持つ有効な Member があれば、BR50.16 の退会（leftAt、displayName 空、accountId 空、household.member-left の記録）を行う。そのとき有効な Member が他にいなければ BR50.22 のグループ削除を行う。有効な Member がなければ（すでに退会済み、または元々なかった）何もしない。同じ出来事を何度受けても結果が同じ（冪等）。好き嫌いの削除は、member-left を受ける好き嫌い（U2）の受け口が行う（BR50.17）"
    violation: "受け口の失敗は記録して、配り直しで再試行する（BR50.23）。アカウント削除そのものは取り消さない"
    source: [FR7.5, AC7.4.1, AC7.4.2, C3, ADR-007]
  - id: BR50.22
    statement: 最後の 1 人が抜けたら、グループのデータを削除する。U7 は自分の持つグループ、メンバー、招待を消し、「グループが削除された」出来事を出して、他のユニットが自分のデータを消す。これは暫定の案で、1st バージョンを触ってから見直す。
    category: policy
    applies_to: [Household, Member, Invitation, DomainEventRecord]
    trigger: 有効なメンバーが 0 人になる退会（抜ける、アカウント削除）
    logic: "THEN 退会の処理（BR50.16）に続けて、同じグループへの参加（BR50.12）や他の退会と直列に（1 件ずつ）、1 つの処理として次を行う（削除済み、または削除中のグループへの参加は「このリンクは使えません」。最後に確定した退会がグループを削除する）：その householdId の Invitation を消す、Member の行を消す（このグループは存在しなくなるため。退会メンバーの表示先もなくなる）、Household を消す、household.deleted（householdId）を DomainEventRecord に記録する。出来事の受け手（料理、好き嫌い、作った記録、候補の提案、献立、買い物リスト、画像づくり）が、それぞれ自分のデータを消す。出来事の順序は保証されないので、member-left と household.deleted が続けて来ても結果が同じになる。グループがなくなったあとも、アカウントは残る（再びグループを作れる）"
    violation: "出来事の配達が遅れる間、消えるはずのデータが残る。その間の画面の見え方は、1st バージョンのあとで見直す（契約の未決事項）。ただし、グループがすでにないため、どの画面からもそのデータには届かない（BR2.3）"
    source: [FR7.6, AC7.5.1, ADR-007, C3]
    status: provisional

  # ---------- 出来事の配達 ----------
  - id: BR50.23
    statement: 出来事は、確定した処理と同じ処理で記録してから配る。少なくとも 1 回届くようにし、配れなかったものは配り直す。出来事は ID だけを持ち、個人情報は入れない。
    category: constraint
    applies_to: [DomainEventRecord]
    trigger: 出来事を出す処理（BR50.16、BR50.20、BR50.22）
    logic: "各出来事に eventId を付ける。記録は、元の操作と同時に確定する（操作だけ確定して出来事がない、という状態を作らない）。配達は、確定のあとに行う。deliveredAt が空のものは、一定の間隔と、アプリの起動のたびに配り直す。受け手は、同じ eventId を二度受けても結果が同じになるように作る。出来事の中身は eventId、occurredAt、accountId／householdId／memberId のみ（メールアドレス、表示名は入れない）"
    violation: "配達の失敗は、元の操作を取り消さない。失敗は運用者に分かる形で記録する（BR50.26 の伏せ字に従う）"
    source: [ADR-007, C3, NFR3.4]
  - id: BR50.24
    statement: 配り直しで、同じ出来事が重ねて届いても、受け口の結果は変わらない。
    category: constraint
    applies_to: [DomainEventRecord, Member, Household]
    trigger: 出来事の再配達
    logic: "account.deleted の受け口は BR50.21、退会の処理は BR50.16 のとおり、すでに済んでいれば何もしない。グループ削除の処理は、グループがすでにない場合は何もしない。順序が入れ替わっても（例：グループ削除のあとに member-left）、エラーにしない"
    violation: "（結果が変わるのは設計の欠陥として扱う）"
    source: [ADR-007, C3]

  # ---------- メール送信の窓口とセキュリティ ----------
  - id: BR50.25
    statement: メールの送信は、窓口（MailSenderPort）を通して行う。通し版では実際には送らず、「開発用の送信箱」に記録して画面で見られるようにする。
    category: policy
    applies_to: [DevMailOutbox, PasswordResetToken]
    trigger: 再設定のリンクを送るとき
    logic: "窓口は「宛先、件名、本文」を受け取り、「受け付けた」かエラーを返す（C5）。送信は裏の処理で行い、画面の応答は待たせない。外部のサービスを入れたあとは、タイムアウト 10 秒、再試行 3 回（5・15・45 秒）の暫定の値に従う（C5）。通し版の代替は、DevMailOutbox に本文（再設定リンクを含む）を記録する。記録は、リンクの有効期限（60 分）で見えなくし、消す。この送信箱は通し版・開発の設定のときだけ有効にし、本番の設定では無効にする。招待リンクは、発行した本人の画面に表示するので、窓口を通さない"
    violation: "送信箱が無効な設定で外部の送信サービスも未設定のときは、再設定の応答は変えずに（BR50.1）、運用者に分かる形で記録する"
    source: [FR7.1, C5, NFR3]
    decision: Q1 A
  - id: BR50.26
    statement: ログや記録には、パスワード、再設定や招待のリンクの値、メールアドレス、表示名をそのまま出さない。出す必要があるときは伏せ字にする。
    category: constraint
    applies_to: [Account, PasswordResetToken, Invitation, DomainEventRecord, DevMailOutbox]
    trigger: ログ、エラー記録、運用者向けの記録
    logic: "パスワードとリンクの値（元の値）は、一切出さない。変換値も出さない。メールアドレスは、伏せ字にする（例：先頭 1 文字と、@ のあとのドメインだけを残し、間を伏せる）。表示名は出さない。個人を特定する必要があるときは accountId、householdId、memberId を使う。リンクの URL は、そのまま出さず「（リンク）」と記す。DevMailOutbox の本文は、ログに出さない"
    violation: "（出たら設計の欠陥として扱う。テストでログの内容を確かめる）"
    source: [NFR3, NFR3.1, NFR3.4]
  - id: BR50.27
    statement: 再設定と招待のリンクを開いた画面から、外部のページへ、リンクの値が渡らないようにする。
    category: constraint
    applies_to: [PasswordResetToken, Invitation]
    trigger: リンクを開いた画面の表示
    logic: "リンクを開いた画面は、外部のページへの参照元（リンクの値を含む URL）を渡さない。外部の広告や解析のスクリプトを読み込まない。リンクの値を使い終わったら（確定、参加、期限切れの表示のあと）、画面の URL から値を取り除く"
    violation: "（出たら設計の欠陥として扱う）"
    source: [NFR3]
  - id: BR50.28
    statement: U7 の操作は、ログイン中の人が、自分のグループと自分のアカウントに対してだけできる。再設定の要求と確定、招待の確認、ログインは、ログイン前でもできる。
    category: authorization
    applies_to: [Account, Member, Invitation]
    trigger: U7 のすべてのリクエスト
    logic: "ログイン前でもできる：再設定の要求（BR50.1）、再設定の確定（BR50.4）、招待リンクの確認（BR50.11）。ログインが要る：招待の発行（BR50.9）、参加（BR50.12）、抜ける（BR50.16）、アカウント削除（BR50.20）。対象のグループとアカウントは、ログイン状態から決める（BR2.3）"
    violation: "未ログインは「未ログイン」として拒否する。他のグループやアカウントへの指定は「見つからない」（BR2.4）"
    source: [NFR3.2, ADR-005]
```

## ルールの概要

| 範囲 | ルール | 内容 |
|---|---|---|
| パスワード再設定 | BR50.1〜BR50.4 | 常に同じ応答、1 時間 3 回まで、60 分・1 回のリンク（変換値のみ保存）、確定でロック解除とログイン状態の終了 |
| ログイン失敗の制限 | BR50.5〜BR50.8 | アカウント単位で 5 回失敗→15 分ロック、ロック中は正しくても不可・延びない、成功や期限切れで数え直し、未登録は数えない |
| 招待リンク | BR50.9〜BR50.15 | 7 日・1 回・10 本まで・変換値のみ保存、開く前の確認、参加は 1 人 1 グループ、期限切れは再発行、他グループの招待は使えない、再参加は新しいメンバー |
| 抜ける | BR50.16〜BR50.19 | 退会＋名前を消す＋出来事、好き嫌いは受け口が外す、保存した項目と記録は残る、確認（最後の 1 人は明示） |
| アカウント削除 | BR50.20〜BR50.21 | メール・パスワード・表示名を消す、出来事を受けて退会にする |
| グループ削除（暫定） | BR50.22 | 最後の 1 人が抜けたらグループ・メンバー・招待を消し、household.deleted を出す |
| 出来事 | BR50.23〜BR50.24 | 同じ処理で記録、at-least-once、ID のみ、配り直し、冪等 |
| セキュリティ | BR50.25〜BR50.28 | メールの窓口と通し版の送信箱、ログの伏せ字、リンクの参照元の保護、操作できる人 |

## 補足

- 出来事の受け口（U7 の中では家族グループ）以外の受け口は、各ユニットが作る。U7 は出す側であり、他のユニットに依存しない（`unit-of-work.md`）。
- HTTP の状態番号は Contract Design（C1）の担当であり、ここでは「入力エラー」「未ログイン」「認証エラー」「見つからない」「競合」の言葉で書く。期限切れだけは、契約どおり 410 にあたる。
- 「十分に長いランダムな値」の長さと、変換の方式は、NFR Design で決める。
- BR50.19 のパスワード再入力の失敗回数（連続 5 回で 15 分）は、ログインの制限（BR50.5）と同じ数字に揃えた設計の判断である。
