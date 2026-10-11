## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/contract-design/contract-summary.md > C2 MealPlanQuery と GET /shopping-list | 買い物リスト（U3）が献立（U4）の材料を問い合わせる形になっている。ユニットの依存では U4 が U3 に頼る向き（U4 → U3）で、U3 は U4 に頼らない。向きが逆で、U3 は U4 なしでは完結せず、U3 の単独ビルドが U4 を待つ恐れがある | 向きをそろえる。U3 が「材料の一覧を受け取って集計する」窓口を提供し、U4 がそれを呼ぶ形に直す。または依存の図の側を直す。/shopping-list の「献立からは U4」の注記も合わせて直す | New |
| R-02 | Major | 同 > C2 TasteExclusion、CookLogImpression、ImageRequest | U1 の候補の提案が U2・U5 の窓口を呼び、U1 の料理が U6 の画像づくりを呼ぶ。依存では U2、U5、U6 が U1 に頼る向きなので、呼び出しが逆向きになる。U1 が先に作られるとき、これらの窓口が U1 側に空の既定の実装つきで置かれる、とは書かれていない | 窓口の定義と「何も登録されていないときの既定の動作（除外なし、感想なし、画像は none）」を U1 側の持ち物と明記する。U2、U5、U6 は実装を足すだけにして、並行ビルドを妨げないようにする | New |
| R-03 | Major | 同 > C1 paths（/auth 以下、/households/join ほか） | Must のストーリーに必要な窓口が足りない。ログアウト、パスワード再設定の「新しいパスワードの確定」（案内メールのリンク先）、招待リンクの中身の確認、メンバー一覧がない。signup の重複メール（409）、ログインしていないとき（401）も定義がない | 足りない窓口を追加するか、不要と判断した理由を書く。共通の 401、404 の応答も、Error 型を使って定義する | New |
| R-04 | Major | 同 > /auth/login と U7 | ログインのロック（5 回、15 分）は U7 の持ち物だが、ログインの窓口は U1 にある。U1 は U7 に頼らないので、U1 の通し版でロックを行うのか、U7 の拡張として足すのかが決まっていない。NFR3.1 の持ち主が不明確 | ロックの判定を U1 の窓口の拡張点（ログイン失敗を通知する、ロック中か確かめる）として定義し、U7 が実装すると明記する。または U1 に移す | New |
| R-05 | Major | 同 > C3 household.deleted の受け手 | 受け手に画像（U6、登録した画像の実体）と招待リンク（U7）が入っていない。グループを削除しても画像が残る。account.deleted の受け手は一つも書かれておらず、メンバーのアカウント削除時の「退会したメンバー」表示（ADR-009）とどう結びつくかが読めない | household.deleted の受け手に U6、U7 を足す。account.deleted の受け手と、その結果（メンバーが抜ける、最後の 1 人ならグループ削除）を書く | New |
| R-06 | Minor | 同 > C3 の配信と C2 の rules | 「内部の呼び出しは再試行しない」と「出来事は少なくとも 1 回届くまで再送する」が並んでいて、読み手が混乱する。member-left と household.deleted が続けて出たときの順序の保証もない | 再送は出来事だけの話と明記する。順序に依存しない受け手にする旨を書く | New |
| R-07 | Minor | 同 > C4、C5 の policy | タイムアウト 30 秒に再試行 3 回、間隔 5・15・45 秒だと、最悪で約 3 分かかる。数字の根拠がなく、画像づくりが同期か非同期かの記述もない（NFR2 の性能との関係も書かれていない）。C5 のメールも、画面の応答を待たせるかが不明 | 再試行は裏の処理で行い、画面の応答は待たせないと明記する。数字は「暫定」と注記するか、根拠を添える。NFR2 の対象（候補 1 件の取得など）の応答時間の目標を契約に書く | New |
| R-08 | Minor | 同 > OpenAPI の Dish、CookRecord スキーマ | 登録の入力にも同じスキーマを使うので、dishId、recordId、isDeleted、isSample などサーバーが決める項目まで必須または入力可に見える。多くの応答に schema がなく、/households/join、/meal-plans などに requestBody もない。このままでは画面側とサーバー側が別々に解釈する恐れがある | 読み取り専用の項目に readOnly を付けるか、入力用の型を分ける。主な応答と requestBody に schema を付ける | New |
| R-09 | Minor | 同 > POST /records（cookedOn）、GET /records（month） | 「今日まで」の判定に使うタイムゾーンが決まっていない（FR6 の日付）。パスの /suggestions/pass の状態を保持する場所も「画面側でもよい」とあいまいで、U1 の内容が確定しない | タイムゾーン（例：日本時間）を決めて書く。パスの状態の持ち主を一つに決める | New |
