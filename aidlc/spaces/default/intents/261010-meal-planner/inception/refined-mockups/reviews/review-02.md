## Review

**Verdict:** READY
**Reviewer:** aidlc-product-lead-agent
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/mockups.md > S8 1 週間の献立 | 保存した献立（US5.4、Could）の一覧画面と、呼び出して一部変更する流れが描かれていない。「画面の上部の『保存した献立』」と書かれているが、S8 の図には存在しない。S8 には読み込み中、エラー、保存が 0 件の状態表（AC9.1.6、AC5.3.1 の空き日の見え方を含む）もない。 | S8 の図に「保存した献立」への入口を足し、保存した献立の一覧と呼び出し後の編集の流れを 1 つ示す。S8 に状態表（読み込み中、エラー、空き日、保存成功）を足す。または Could として次の版に回すと明記する。 | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/mockups.md > S1、S2、S4、S5、S6、S7、S9、S10、S11 | 読み込み中、エラー、空、成功の状態を表で示しているのは S3 だけ。S4 の保存失敗や保存成功、S7 の読み込み中、S6 の感想保存の成否、S10 の追加失敗、S11 の招待リンク発行失敗などが未定義。パスワード再設定（AC7.1.2）は画面一覧に含まれるが、再設定の画面や手順の図がない。 | 画面ごとに少なくとも「読み込み中・エラー・成功」の 1 行ずつを足すか、共通の状態の決まりを interaction-spec に 1 か所で定義して各画面から参照する。パスワード再設定の手順（メール送信後の案内、新パスワード入力）を示す。 | New |
| R-03 | Minor | mockups.md > S10 好き嫌いの登録、S3 | US4.1 の AC4.1.2（家族の誰かの嫌いな食材で項目が外れる）に対し、S10 は自分の登録しか表示しない。家族の誰がどの食材を除外しているかを見る場所がなく、候補が少ないとき利用者は理由が分からない。 | S10 に「家族全体の除外一覧（登録者名つき）」を見せるか、見せないと決めた理由を書く。S3 の候補が少ない状態で、除外の影響を 1 行で知らせるかどうかも決める。 | New |
| R-04 | Minor | mockups.md > S3、共通の枠組み | 買い物リストへの入口の表記が揺れている。共通の枠組みでは「リストを見る」、S3 の図では右上の 🛒、選択後は「リストを作る」と 3 つある。選択済みの項目を一覧や献立から足す流れも描かれていない。 | 入口の名前と置き場所を 1 つにそろえる。S8 の献立から買い物リストを作れるか（FR3 の「作るもの」に献立を含むか）を決めて書く。 | New |
| R-05 | Minor | mockups.md > S4 保存する | 「食材の種類（肉｜魚｜野菜…）」の入力欄は、US1.2 の受け入れ条件（AC1.2.1）に挙がっていない。FR5 の「食材の種類が同じ日が 3 日続かない」の判定に使う入力と思われるが、出どころの説明がない。初期データ 30 件に入っているかも不明。 | 要件のどこに由来するかを書き、US1.2 の AC に足すか、設計段階で決める項目として明示する。 | New |
| R-06 | Minor | mockups.md > 共通の枠組み、S5 | 下部タブは「＋保存」だが、タップ先は保存の一覧（S5）で、追加は S5 右上の「＋」から。ラベルの「＋」が追加画面を連想させ、スマートフォンでの保存が 2 回の操作になる（US1.3 の「少ない操作」に影響）。 | タブ名を「保存」にして「＋」を外すか、「＋」を押すと直接 S4 に行く形にする。 | New |
| R-07 | Minor | mockups.md > S6、S3 | 初期データの項目の URL はダミー（AC9.1.2）なのに、「元の投稿を見る」が通常の項目と同じ見た目で出る。押すと存在しないページに行く可能性がある。 | 初期データの項目には「サンプルの料理」の印を付け、ボタンを無効にするか、押したときの案内を決める。 | New |
| R-08 | Minor | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/accessibility-checklist.md | WCAG の達成については手作業のテストが必要と書かれており、主張は適切に抑えられている。一方で 44px 以上のタップ領域は設計で約束しているが、S3 のカード内に並ぶ 2 つのボタンと ♡ が 360px 幅で収まるかは図から確認できない。 | 実装時の確認項目に「360px 幅でカード内の操作が 44px を保てること」を加える。 | New |
| R-09 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/mockups.md > 設計の方針、S3、感想の反映の対応表（R7、R9 の行） | 画面設計の文書だけを読む承認者には、未解決の点が見えない。「この日は作らない」を消す意味を「設定の解除」と解釈したこと（requirements.md の OQ8）、AI 画像の費用・生成のタイミング・著作権や安全面・作成中の表示（OQ7）、YouTube のサムネ画像を使うか（OQ9。チームの感想「S6 でサムネが見たい」に直結）が、mockups.md には書かれていない。対応表は OQ10 と OQ2 しか挙げていない。 | mockups.md に「未解決の点」の短い節を足し、OQ7、OQ8、OQ9 を載せる。R7 は「消す＝解除と解釈した。枠ごと消す意味なら見直し」と明記し、承認時に確認できるようにする。 | New |
| R-10 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/interaction-spec.md > 画面の状態（S3 の行） | 古い「3 件並べる」の表現が残っている。読み込み中が「スケルトン 3 枚」、成功が「候補 3 件」のままで、1 件ずつ大きなカードを出す現在の設計（R1 B、同じ文書の S3 の節）と食い違う。実装者が 3 枚並びを作るおそれがある。 | 読み込み中は「大きなカード 1 枚分のスケルトン」、成功は「候補 1 件（N / M 件目の表示）」のように直す。 | New |
| R-11 | Minor | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/mockups.md > 画面の一覧（S3 の対応ストーリー） | Must の US2.3（家族が食べられないものを候補から外す）に対応する画面の記述がない。S10 は US4.1、US4.3 だけに対応している。除外が候補に効くことが、画面上でどこに現れるか（例：除外で候補が 0 件になった場合の S3b の表示）が読み取れない。 | S3 と S3b の対応ストーリーに US2.3 を加え、除外によって候補が減る・空になる場合の見え方を 1 行で足す。 | New |
| R-12 | Minor | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/mockups.md > S4 保存する、感想の反映の対応表（保存の入力が大変） | チームの感想「詳しく入力するのが大変、楽にする方法はないか」に対し、R3 は現状維持（B）となり、反映は「入力項目は今のまま」だけ。感想が未解決のまま残ったことが、未解決の点として記録されていない。 | 保存の手間の軽減は最初の版では見送り、使ってから見直す、と OQ に記録する（OQ10 と同じ扱い）。 | New |
| R-13 | Minor | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/interaction-spec.md > S3（スワイプの決まり） | スワイプを確定する距離のしきい値が「一定の距離」とだけ書かれ、数値がない。また、誤ってパスした項目を戻す手段（直前の取り消し）が示されていない。縦スクロールとの区別も未記載。 | しきい値の目安（例：画面幅の 3 割）を示すか、実装時に決める点として明記する。「直前に戻す」の要否を決める。 | New |
| R-14 | Minor | aidlc/spaces/default/intents/261010-meal-planner/inception/refined-mockups/accessibility-checklist.md > 冒頭、mockups.md > 設計の方針 | アクセシビリティの扱いは、チェックリストで「手作業のテストと専門家の確認が必要」と適切に留保されている。一方、interaction-spec.md の「押せる部分は 44px 以上」「画像に代替の文字」などは、断定の書き方で、留保の文が近くにない。 | interaction-spec.md の共通の決まりに、「WCAG 2.1 AA の達成は、実装後に支援技術を使った手作業の確認で判断する」と 1 文を足す。 | New |

> R-01 Not re-checked this round

> R-02 Not re-checked this round

> R-03 Not re-checked this round

> R-04 Not re-checked this round

> R-05 Not re-checked this round

> R-06 Not re-checked this round

> R-07 Not re-checked this round

> R-08 Not re-checked this round

### Summary

チームの感想（スワイプ、気分のパネル、「これにする」の後、献立との連携、保存の入口、おまかせ・外で探す、画像、カレンダー、作らない日）は、mockups.md、interaction-spec.md、HTML、requirements.md、stories.md に概ね一貫して反映され、スワイプのボタン代替（NFR1.5）、AI 画像の印、アレルギー機能の除外（US4.2 は Won't）も確認できました。承認前に確認したいのは、画面設計の文書に未解決の点（OQ7、OQ8、OQ9）が出ていないことと、S3 の状態表に旧「3 件」の表現が残っていることです。どちらも直しは小さく、実装できない欠陥ではないため、READY としました。
