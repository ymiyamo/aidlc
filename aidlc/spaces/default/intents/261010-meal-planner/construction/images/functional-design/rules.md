# 業務ルール：U6 画像

「こういうときは、こうする」という決めごとです。正（source of truth）は下の yaml ブロックです。ルール番号は `BR60.{連番}`（BR60 = 画像）です。

## 根拠（Sources）

- [Q1〜Q5] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` U6 の節
- [memory] ADR-005（所属確認）、ADR-008（論理削除）、ADR-009（ID だけの参照）、`contract-summary.md`（C2 ImageRequest、C4 ImageGeneratorPort）
- [requirements] FR1.7〜FR1.9、FR12.3、FR12.6、NFR3.5、NFR3.6

## ルールの定義

```yaml
rules:
  - id: BR60.1
    statement: 登録できるのは画像だけ。ファイルの中身で判定し、拡張子や申告された種類だけでは信じない。
    category: validation
    applies_to: [RegisteredImage]
    trigger: 画像の登録
    logic: "IF ファイルの中身が JPEG・PNG・WebP・GIF のどれでもない THEN 登録しない"
    violation: "登録せず、「画像ではありません。JPEG、PNG、WebP、GIF の画像を選んでください」と表示する（入力エラー）。すでにある登録画像は変わらない"
    source: [FR1.8, NFR3.5, NFR3.6]
    decision: Q3 A
  - id: BR60.2
    statement: 登録できる画像は 1 枚 5MB（5×1024×1024 バイト）以下。
    category: validation
    applies_to: [RegisteredImage]
    trigger: 画像の登録
    logic: "IF 大きさが 5MB を超える THEN 登録しない。ちょうど 5MB は登録できる。大きさは、受け取った中身の実際の大きさで数える（申告された大きさを信じない）。空のファイルは画像ではないので BR60.1 で扱う"
    violation: "登録せず、「5MB を超えています。5MB 以下の画像を選んでください」と表示する（入力エラー）。すでにある登録画像は変わらない"
    source: [FR1.8, NFR3.6]
    decision: Q3 A
  - id: BR60.3
    statement: 登録画像があるときは、登録画像を表示し、生成画像は表示しない。
    category: policy
    applies_to: [RegisteredImage, GeneratedImage, DishImage]
    trigger: 候補、詳細、一覧など、画像を見せるとき
    logic: "IF 料理に RegisteredImage がある THEN DishImage = { source: registered, status: ready, isAiGenerated: false }。生成画像とその印は返さない"
    violation: "なし"
    source: [FR1.7, FR1.8]
    decision: Q2 A
  - id: BR60.4
    statement: 登録画像がない料理には、生成画像を表示し、「AI が作ったイメージ」の印を付ける。
    category: policy
    applies_to: [GeneratedImage, DishImage]
    trigger: 候補、詳細、一覧など、画像を見せるとき
    logic: "IF RegisteredImage がなく、GeneratedImage（または初期データの SeedImage）が ready THEN DishImage = { source: generated, status: ready, isAiGenerated: true }。画面は、isAiGenerated が true の画像に必ず「AI が作ったイメージ」の印を出す"
    violation: "なし"
    source: [FR1.7, FR1.9]
  - id: BR60.5
    statement: 登録画像は 1 料理に 1 枚。保存または編集の画面から登録でき、再登録すると置き換わり、「画像を外す」と生成画像の表示に戻る。
    category: policy
    applies_to: [RegisteredImage]
    trigger: 保存・編集の画面での登録、再登録、外す操作
    logic: "新しい料理の保存画面で画像を選んだ場合は 2 段階にする：先に料理を保存し、その dishId で画像を登録する。画像が入力エラー（BR60.1、BR60.2）のときも料理は保存済みとし、編集画面で理由を示して再登録できる。登録が成功したら、同じ dishId の古い RegisteredImage を置き換える（古い実体は消す）。同時に 2 件の登録が来ても、有効なのは 1 件だけ（最終的に一意を守る）。外す操作で RegisteredImage を削除する。外す操作を繰り返しても結果は同じ。グループのメンバーなら誰でも登録・置き換え・外すことができる"
    violation: "他のグループの料理、または削除済みの料理は「見つからない」（BR60.6）"
    source: [FR1.8]
    decision: Q2 A
  - id: BR60.6
    statement: 画像の読み書きは、ログイン中の人が所属するグループの範囲に限る。他のグループの画像は、存在しないものとして扱う。
    category: authorization
    applies_to: [RegisteredImage, GeneratedImage, DishImage]
    trigger: 画像の登録、取得、外す、画像の場所へのアクセス
    logic: "householdId は画面の入力ではなく、ログイン状態から決める（ADR-005）。すべての問い合わせを householdId で絞る。dishId が自分のグループの料理でなければ何も返さず、何も変えない。画像の場所（url）も、アクセスのたびに所属を確認する。場所を知っていても、別のグループの人は取れない。画像の保管の場所の名前（storageKey）は推測できない値にして、そのまま公開しない"
    violation: "「見つからない」（存在しないことと、他のグループのものであることを区別しない）。未ログインは「未ログイン」"
    source: [NFR3.2, NFR3.6, ADR-005]
  - id: BR60.7
    statement: 生成画像は、画像がない料理に対して、差し替えられる入口（ImageGeneratorPort）を通して裏で作る。同じ料理への要求は 1 件にまとめる。画面の応答は待たせない。
    category: policy
    applies_to: [GeneratedImage]
    trigger: 料理の保存・編集の直後、および、表示したときに登録画像も作成記録もない場合
    logic: "要求（ImageRequest.requestGeneration）は、すぐ accepted を返し、裏で GeneratedImage（pending）を作って生成を行う。IF 同じ dishId の GeneratedImage がすでにある THEN 作り直さない（冪等）。ただし pending の期限を設ける：requestedAt から 10 分たった pending は、裏の処理が止まったものとして failed（とみなす）とし、次の取得（WF3）で再要求できる（requestedAt を更新し、attemptCount を 0 に戻して pending から作り直す）。IF RegisteredImage がある THEN 生成を要求しない。生成は ImageGeneratorPort.generate（入力：料理名と材料から作る短い文、大きさ。出力：画像のバイト列またはエラー）だけを使う。通し版のポートの実装は、ローカルで作る固定の絵（ダミー）で、料理名から色を決める。外部のサービスは呼ばない。サービスが決まったら、ポートの実装を差し替える"
    violation: "要求が失敗しても、料理の保存・編集は成功のまま。画像は BR60.8 の表示になる"
    source: [FR1.7, OQ7]
    decision: Q1 A
  - id: BR60.8
    statement: 生成画像が作成中、または失敗しているときは、色の枠を出す。作成中は「作成中」と示す。
    category: policy
    applies_to: [DishImage]
    trigger: 画像を見せるとき
    logic: "GeneratedImage が pending THEN DishImage = { source: none, status: pending }（画面は色の枠と「作成中」）。failed THEN DishImage = { source: none, status: failed }（画面は色の枠のまま。「AI が作ったイメージ」の印は出さない）。記録がなく、要求した直後 THEN pending として扱う。利用者に失敗の理由は見せない。画面は、作成中のとき、あとでもう一度取りに行く"
    violation: "なし"
    source: [FR1.7, OQ7]
    decision: Q5 A
  - id: BR60.9
    statement: 初期データ 30 件の料理には、データファイルと並べた画像素材（seedKey ごとに 1 枚）を生成画像として表示する。グループごとに複製しない。素材を差し替えれば、プログラムを変えずに反映される。
    category: policy
    applies_to: [SeedImage, DishImage]
    trigger: 初期データの料理(source が seed)の画像を見せるとき
    logic: "IF 料理が seed で RegisteredImage がない THEN seedKey に対応する SeedImage を、DishImage = { source: generated, status: ready, isAiGenerated: true } として返す（生成を要求しない）。IF 利用者が登録画像を付けた THEN BR60.3 に従い、登録画像を優先する。素材ファイルの差し替えは、既存のグループにも以後の表示で反映される（読み取り専用で共有するため）。通し版の素材は、ダミーの絵（ローカルで作る固定の絵）"
    violation: "素材が見つからない、または形式・大きさが BR60.1、BR60.2 の範囲外 THEN その料理は色の枠（source: none, status: failed）にし、異常を運用者に分かる形で記録する。ほかの料理の表示は止めない"
    source: [FR12.3, FR12.6]
    decision: Q4 A
  - id: BR60.10
    statement: 「AI が作ったイメージ」の印は、生成画像にだけ付ける。登録画像には付けない。
    category: policy
    applies_to: [DishImage]
    trigger: 画像を見せるとき
    logic: "isAiGenerated = (source が generated)。初期データの素材も generated として扱う。作成中・失敗・画像なしには印を出さない（画像がないため）"
    violation: "なし"
    source: [FR1.9]
  - id: BR60.11
    statement: 生成の失敗は再試行し、だめなら failed にする。費用と回数の上限を ImageGen の中で管理する。
    category: constraint
    applies_to: [GeneratedImage]
    trigger: 生成の実行
    logic: "待つ上限と再試行の回数・間隔は C4 の暫定の値に従う（30 秒、再試行は最大 3 回）。回数は attemptCount に数える。最大の回数に達した THEN failed にして止める。費用または回数の上限を超えたとき THEN 生成せず failed にする。上限の値は未決定（OQ7）なので、設定として外に出す。通し版のダミーは外部を呼ばないので、上限に当たらない"
    violation: "利用者には見せない。運用者が分かる形で記録する"
    source: [OQ7]
  - id: BR60.12
    statement: 料理が削除されたとき、またはグループが削除されたとき、その料理・そのグループの画像（登録画像と生成画像の実体を含む）も消す。
    category: policy
    applies_to: [RegisteredImage, GeneratedImage]
    trigger: 料理の削除（ImageRequest.deleteForDish）、household.deleted の受信
    logic: "対象の dishId（または householdId）の RegisteredImage、GeneratedImage、その保管の実体を消す。同じ通知を何度受けても結果は同じ（冪等、ADR-007）。初期データの素材（SeedImage）は共有なので消さない。実体の削除に失敗しても、記録の削除は行い、残った実体を運用者が分かる形で記録する"
    violation: "なし（エラーにしない）"
    source: [NFR3.2, ADR-007, ADR-008]
  - id: BR60.13
    statement: 人の参照は memberId だけを持ち、名前は持たない。他のコンポーネントの ID だけを値として持つ。
    category: constraint
    applies_to: [RegisteredImage, GeneratedImage]
    trigger: 画像の登録、生成の要求
    logic: "RegisteredImage.uploadedBy は memberId。dishId、householdId も ID だけで参照し、料理の内容を複製しない。退会したメンバーが登録した画像は、そのまま残る（memberId は残り、表示名は Household 側で消える。ADR-009）"
    violation: "（設計の制約。違反は設計の欠陥として扱う）"
    source: [ADR-009]
  - id: BR60.14
    statement: 画像には、料理名から作った代わりの文字（altText）を付ける。
    category: policy
    applies_to: [DishImage]
    trigger: 画像を見せるとき
    logic: "altText = 料理名。生成画像は「（料理名）のイメージ（AI が作ったイメージ）」とする。色の枠のときも料理名を示す"
    violation: "なし"
    source: [NFR1.4]
```

## ルールの概要

| ルール | 内容 |
|---|---|
| BR60.1〜BR60.2 | 画像だけ（中身で判定）、5MB 以下。違反は理由を表示して登録しない |
| BR60.3〜BR60.5 | 登録画像を優先、なければ生成画像と印、1 料理 1 枚（置き換え・外す） |
| BR60.6 | グループの範囲に限る。他のグループの画像は「見つからない」 |
| BR60.7〜BR60.8 | 生成は差し替えられる入口を通して裏で行う。作成中・失敗は色の枠 |
| BR60.9 | 初期データの画像素材。差し替えはファイルだけで反映 |
| BR60.10〜BR60.11 | 印は生成画像にだけ。失敗の再試行と上限 |
| BR60.12〜BR60.14 | 料理・グループの削除で画像も消す、ID だけの参照、代わりの文字 |

## 補足

- HTTP の状態番号は Contract Design（C1）の担当。ここでは「入力エラー」「未ログイン」「見つからない」の言葉で書く。契約では、5MB 超は 413、画像でないものは 415。
- 画像の実体の保管は抽象に書く（ローカルではディスク、AWS ではオブジェクト保管）。具体的な技術は NFR Design、Infrastructure Design で決める。
