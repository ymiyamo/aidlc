# 契約のまとめ（Contract Design）

境界をまたぐやりとりの取り決め（契約）を、まとめて決める。回答は `contract-design-questions.md`（Q1〜Q5、すべて A）。全体を 1 つのアプリとしてデプロイする（Units Generation の Q2 A）ので、「外に公開する API」はなく、利用者は自分たちの画面だけである。

## Sources

- [Q1]〜[Q5] `contract-design-questions.md` の回答（すべて A）
- [units] `units-generation/unit-of-work.md`、`unit-of-work-dependency.md`（U1〜U7 と依存）
- [components] `domain-design/components.md`、`decisions.md`（ADR-005 所属確認、ADR-007 出来事、ADR-008 論理削除、ADR-009 ID だけの参照）
- [requirements] `requirements.md`（NFR3 セキュリティ、NFR2 性能、FR12 初期データ ほか）

## 用語の対応表

| 日本語 | 英語 |
|---|---|
| 契約 | Contract |
| 提供する側 | Provider |
| 使う側 | Consumer |
| イベント | Event |
| 冪等 | Idempotent |
| 再試行 | Retry |
| 共有スキーマ | Shared schema |

## 契約の一覧

| # | 提供する側（ユニット） | 使う側 | 仕組み | 持ち主（仕様を管理するユニット） |
|---|---|---|---|---|
| C1 | サーバー（U1〜U7 が、それぞれ自分の機能の窓口を持つ） | 画面（ブラウザ。外部の使う側ではなく、自分たちの画面） | REST（HTTP と JSON）、住所に `/api/v1` | 窓口を持つ各ユニット |
| C2 | 窓口の定義と既定の実装：U1（料理、候補の判定、除外・感想・画像の拡張点）。本物の実装：U2（除外）、U5（感想）、U6（画像）。ShoppingListCompose：U3 | 他のユニットのコンポーネント（U1 の候補の提案と料理、U4 の献立） | アプリの中の関数呼び出し（窓口の形を文書で決める。ユニットの依存の向きに合わせる） | 窓口を定義するユニット（拡張点は U1、ShoppingListCompose は U3） |
| C3 | U7（家族グループ、アカウント）、U1（グループが作られた） | 各コンポーネントの受け口を持つユニット | アプリの中のイベント（データベースに記録して配る） | 出す側のユニット |
| C4 | U6（画像づくり） | 外部：生成 AI サービス | 外部 API の呼び出し（自分たちの側の窓口を決める） | U6 |
| C5 | U7（アカウント） | 外部：メール送信サービス | 外部 API の呼び出し（自分たちの側の窓口を決める） | U7 |

## C1：画面とサーバーの REST API

OpenAPI の形で、窓口を決める。いずれも、`/api/v1` の下にある。ユニットごとに、窓口を持つ。

- **所属の確認（ADR-005）**：グループの ID（householdId）は、リクエストの URL や本文では受け取らない。サーバーが、ログインの情報（セッション）から決める。他のグループの項目の ID を渡しても、何も返らない、何も変わらない（404 を返す）。
- **認証**：ログイン後は、HttpOnly で Secure の Cookie（セッション）を使う（未決定の点あり：下の表）。
- **共通のエラー**：下の `Error` の形で返す。

```yaml
openapi: 3.0.3
info:
  title: 献立ストレス緩和アプリ 画面用 API
  version: v1
servers:
  - url: /api/v1
security:
  - sessionCookie: []
components:
  securitySchemes:
    sessionCookie:
      type: apiKey
      in: cookie
      name: session
  schemas:
    Error:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
          description: 種類のコード（例 VALIDATION_FAILED, NOT_FOUND, LOCKED, FUTURE_DATE_NOT_ALLOWED, DUPLICATE_RECORD）
        message:
          type: string
          description: 利用者に見せる短い文（日本語）
        fieldErrors:
          type: array
          items:
            type: object
            properties:
              field: { type: string }
              message: { type: string }
    Dish:
      type: object
      required: [name, url]
      description: 入力のときは name と url だけが必須。dishId、isSample、isDeleted、image は、サーバーが決める読み取り専用の項目で、入力しても無視する
      properties:
        dishId: { type: string, readOnly: true }
        name: { type: string }
        url: { type: string, description: http または https のみ }
        cookTime: { type: string, enum: [within15, within30, over30] }
        effort: { type: string, enum: [easy, normal, hard] }
        moodTags: { type: array, items: { type: string } }
        ingredientKind: { type: string, enum: [meat, fish, vegetable, egg_soy, other] }
        memo: { type: string }
        isSample: { type: boolean, readOnly: true }
        isFavorite: { type: boolean }
        isDeleted: { type: boolean, readOnly: true }
        ingredients:
          type: array
          items: { $ref: '#/components/schemas/Ingredient' }
        image:
          $ref: '#/components/schemas/DishImage'
    Ingredient:
      type: object
      required: [name]
      properties:
        name: { type: string }
        quantity: { type: number }
        unit: { type: string }
    DishImage:
      type: object
      properties:
        source: { type: string, enum: [registered, generated, none] }
        status: { type: string, enum: [ready, pending, failed] }
        url: { type: string }
        isAiGenerated: { type: boolean, description: true のとき「AI が作ったイメージ」の印を出す }
    CookRecord:
      type: object
      required: [cookedOn]
      description: 入力のときは cookedOn が必須（日本時間の日付）。recordId、dishId、memberLabel は読み取り専用
      properties:
        recordId: { type: string, readOnly: true }
        dishId: { type: string, readOnly: true }
        cookedOn: { type: string, format: date, description: 今日まで。未来は不可 }
        impression: { type: string, enum: [again, never_again], nullable: true }
        cautionMemo: { type: string }
        memberLabel: { type: string, readOnly: true, description: 退会したメンバーは「退会したメンバー」 }
  responses:
    Unauthorized:
      description: ログインしていない、またはセッションが切れた（全ての窓口で共通）
      content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
    NotFound:
      description: 存在しない、または他のグループのデータ（区別しない。ADR-005）
      content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
paths:
  # すべての窓口は、/auth の一部を除き、ログインが必要で、401（Unauthorized）と 404（NotFound）を共通で返す。
  # ---- U1 最小の通し版 ----
  /auth/signup:
    post:
      summary: アカウントを作る（U1）
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email: { type: string, format: email }
                password: { type: string, minLength: 8 }
      responses:
        '201': { description: 作成済み }
        '400': { description: 入力エラー, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
        '409': { description: 登録済みのメールアドレス（DUPLICATE_EMAIL）, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
  /auth/login:
    post:
      summary: ログイン（U1）。ロックの判定は拡張点 LoginAttemptPolicy（U1 の既定は「ロックしない」。U7 が 5 回 15 分の実装を足す）
      security: []
      responses:
        '200': { description: ログイン済み（Cookie を設定） }
        '401': { description: メールまたはパスワードが違う（失敗を LoginAttemptPolicy に知らせる） }
        '423': { description: ロック中（U7 が有効にしたとき）, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
  /auth/logout:
    post:
      summary: ログアウト（U1）
      responses:
        '204': { description: セッションを破棄した }
  /household/members:
    get:
      summary: 現在のグループのメンバー一覧（U1。退会したメンバーは「退会したメンバー」）
      responses:
        '200': { description: メンバーの一覧 }
  /households:
    post:
      summary: グループを作る（U1）。作ると初期データ 30 件が入る
      responses:
        '201': { description: 作成済み }
  /dishes:
    get:
      summary: 保存した項目の一覧（U1）。削除済みは出さない
      parameters:
        - { name: favorite, in: query, schema: { type: boolean } }
      responses:
        '200': { description: 項目の一覧 }
    post:
      summary: 項目を保存する（URL と料理名が必須）（U1）
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Dish' }
      responses:
        '201': { description: 保存済み }
        '400': { description: URL の形が正しくない等 }
  /dishes/{dishId}:
    parameters:
      - { name: dishId, in: path, required: true, schema: { type: string } }
    get:
      summary: 項目の詳細（作った日の一覧を含む）（U1。作った日は U5）
      responses:
        '200': { description: 項目 }
        '404': { description: 他のグループの項目、または存在しない }
    patch:
      summary: 項目を編集する。お気に入りの付け外しを含む（U1）
      responses:
        '200': { description: 更新済み }
    delete:
      summary: 項目を論理削除する（ADR-008）（U1）
      responses:
        '204': { description: 削除済みの印を付けた }
  /suggestions/next:
    get:
      summary: 買い物前の候補を 1 件取る（U1）。絞り込み・除外は U2 が拡張する
      description: パスした項目の状態は**画面（ブラウザ）が持つ**（サーバーは保存しない）。画面は、パスした項目の ID を exclude で渡す。
      parameters:
        - { name: time, in: query, schema: { type: string, enum: [within15, within30, over30] } }
        - { name: effort, in: query, schema: { type: string, enum: [easy, normal, hard] } }
        - { name: moodTag, in: query, schema: { type: array, items: { type: string } } }
        - { name: exclude, in: query, schema: { type: array, items: { type: string } }, description: パスした項目の dishId }
      responses:
        '200': { description: 候補 1 件（N / M 件目の情報を含む） }
        '204': { description: 見終えた、または候補なし }
  /suggestions/random:
    get:
      summary: おまかせで 1 件（U2）。絞り込み・見た料理・選んだものは使わず、嫌いな食材の除外だけ適用する
      responses:
        '200': { description: "項目。status は card / empty（保存が 0 件）/ all_excluded（除外で全部外れた）" }
  /suggestions/count:
    get:
      summary: いまの条件に合う料理の件数（U2。除外と絞り込みの後の数。選んだもの・見た料理は引かない）
      parameters:
        - { name: time, in: query, schema: { type: string, enum: [within15, within30, over30] } }
        - { name: effort, in: query, schema: { type: string, enum: [easy, normal, hard] } }
        - { name: moodTag, in: query, schema: { type: array, items: { type: string } } }
      responses:
        '200': { description: "{ count: number }" }
        '400': { description: 選択肢以外の値 }
  /suggestions/mood-tags:
    get:
      summary: 気分のタグの選択肢（U2。グループの削除済みでない料理が持つタグを、重複なしで集めたもの）
      responses:
        '200': { description: "{ tags: string[] }" }
  /picked-items:
    get:
      summary: 選んだものの一覧（U1）
      responses:
        '200': { description: 一覧 }
    post:
      summary: 「これにする」で選んだものに入れる（U1）
      responses:
        '201': { description: 追加済み }
  /picked-items/{pickedId}:
    delete:
      summary: 選んだものから外す（U1）
      parameters:
        - { name: pickedId, in: path, required: true, schema: { type: string } }
      responses:
        '204': { description: 外した }
  # ---- U2 好き嫌いと絞り込み ----
  /me/dislikes:
    get:
      summary: 自分の嫌いな食材の一覧（U2）
      responses:
        '200': { description: 一覧 }
    post:
      summary: 嫌いな食材を追加する（U2。文字列の一致で判定し、表記ゆれの正規化はしない）
      responses:
        '201': { description: 追加済み }
  /me/dislikes/{dislikeId}:
    delete:
      summary: 嫌いな食材を外す（U2）
      parameters:
        - { name: dislikeId, in: path, required: true, schema: { type: string } }
      responses:
        '204': { description: 外した }
  # ---- U3 買い物リスト ----
  /shopping-list:
    get:
      summary: 買い物リスト（選んだものから集計）（U3）。献立の材料は、献立（U4）が ShoppingListCompose で渡す
      responses:
        '200': { description: 買い物リスト }
  /shopping-list/items/{itemId}:
    patch:
      summary: チェックの付け外し（U3）
      parameters:
        - { name: itemId, in: path, required: true, schema: { type: string } }
      responses:
        '200': { description: 更新済み }
  # ---- U4 献立 ----
  /meal-plans:
    post:
      summary: 1 週間の献立を提案する（U4）
      responses:
        '201': { description: 7 日分（候補が足りない日は空き） }
  /meal-plans/{planId}/days/{date}:
    parameters:
      - { name: planId, in: path, required: true, schema: { type: string } }
      - { name: date, in: path, required: true, schema: { type: string, format: date } }
    put:
      summary: 日の設定。やり直し、料理の割り当て、「作らない」の設定・解除（U4）
      responses:
        '200': { description: 更新済み }
  /meal-plans/{planId}/save:
    post:
      summary: 献立を保存する（U4）
      parameters:
        - { name: planId, in: path, required: true, schema: { type: string } }
      responses:
        '200': { description: 保存済み }
  # ---- U5 作った記録 ----
  /dishes/{dishId}/records:
    post:
      summary: 項目に、作った日の記録を追加する（U5）。未来の日付は 400、同じ日の同じ項目は 409
      parameters:
        - { name: dishId, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CookRecord' }
      responses:
        '201': { description: 追加済み }
        '400': { description: FUTURE_DATE_NOT_ALLOWED, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
        '409': { description: DUPLICATE_RECORD, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
  /records:
    get:
      summary: 作った記録を月ごとに取る（カレンダー用・一覧用）（U5）
      parameters:
        - { name: month, in: query, required: true, schema: { type: string, example: '2026-10' } }
      responses:
        '200': { description: 日ごとの料理名・感想の印と、記録の一覧 }
  /records/{recordId}:
    parameters:
      - { name: recordId, in: path, required: true, schema: { type: string } }
    patch:
      summary: 記録を編集する（U5）
      responses:
        '200': { description: 更新済み }
    delete:
      summary: 記録を削除する（U5）
      responses:
        '204': { description: 削除済み }
  # ---- U6 画像 ----
  /dishes/{dishId}/image:
    parameters:
      - { name: dishId, in: path, required: true, schema: { type: string } }
    put:
      summary: 画像を登録する（U6）。5MB 以下の画像のみ
      requestBody:
        content:
          image/*: { schema: { type: string, format: binary } }
      responses:
        '200': { description: 登録済み }
        '413': { description: 5MB を超える }
        '415': { description: 画像でない }
    get:
      summary: 画像の状態を取る（登録または AI の画像。作成中も返す）（U6）
      responses:
        '200': { description: 画像の状態 }
  # ---- U7 グループとアカウントの管理 ----
  /households/current/invitations:
    post:
      summary: 招待リンクを作る（7 日間有効）（U7）
      responses:
        '201': { description: 招待リンク }
  /invitations/{token}:
    get:
      summary: 招待リンクの中身を確かめる（グループ名、有効かどうか）（U7）。参加前の確認画面用
      security: []
      parameters:
        - { name: token, in: path, required: true, schema: { type: string } }
      responses:
        '200': { description: 有効な招待 }
        '410': { description: 期限切れ（再発行が必要） }
  /households/join:
    post:
      summary: 招待リンクで参加する（U7）。期限切れは 410、すでにメンバーなら 409
      responses:
        '200': { description: 参加済み }
        '409': { description: すでにこのグループのメンバー }
        '410': { description: 期限切れ }
  /households/current/members/me:
    delete:
      summary: グループから抜ける（U7）。最後の 1 人なら、グループを削除する（暫定の案）
      responses:
        '204': { description: 抜けた }
  /auth/password-reset:
    post:
      summary: パスワード再設定の案内メールを送る（U7）。送信は裏の処理で行い、画面の応答は待たせない
      security: []
      responses:
        '202': { description: 受け付けた（メールアドレスが登録済みかどうかは、答えで区別しない） }
  /auth/password-reset/confirm:
    post:
      summary: 案内メールのリンクから、新しいパスワードを確定する（U7）
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [token, newPassword]
              properties:
                token: { type: string }
                newPassword: { type: string, minLength: 8 }
      responses:
        '204': { description: 変更した（使い終えたリンクは無効にする） }
        '410': { description: リンクの期限切れ、または使用済み }
  /account:
    delete:
      summary: アカウントを削除する（U7）
      responses:
        '204': { description: 削除済み }
```

## C2：コンポーネントの間の窓口（アプリの中の関数呼び出し）

関数呼び出しの窓口の形を、共有スキーマ（型）で決める。すべての呼び出しで、確認済みの householdId を必ず渡す（ADR-005）。他のグループの ID を渡しても、何も届かない。

```yaml
shared-schema:
  common:
    CallContext:
      householdId: string   # 入口で確認済み。受け側は、必ずこれで絞る
      memberId: string      # 呼び出したメンバー
  interfaces:
    DishCatalog:            # 提供：Dish（U1）／使う：Suggestion、ShoppingList、MealPlan、CookLog
      listForCandidates:
        in: { context: CallContext }
        out: "Dish[]（削除済みを除く。材料・条件つき）"
      getMany:
        in: { context: CallContext, dishIds: "string[]" }
        out: "Dish[]（削除済みも含む。記録・買い物リスト・過去の献立の表示用）"
      exists:
        in: { context: CallContext, dishId: string }
        out: boolean
    TasteExclusion:         # 窓口の定義と既定の実装：U1（持ち主）／本物の実装：Taste（U2）／使う：Suggestion（U1）
      listExcludedIngredients:
        in: { context: CallContext }
        out: "string[]（グループの全メンバーの嫌いな食材。文字列の一致で判定）"
        default-in-u1: "空の一覧を返す（除外なし）。U2 が本物の実装に差し替える"
    CookLogImpression:      # 窓口の定義と既定の実装：U1（持ち主）／本物の実装：CookLog（U5）／使う：Suggestion（U1）
      latestImpressionsByDish:
        in: { context: CallContext, dishIds: "string[]（一括で聞く）" }
        out: "map dishId -> again | never_again | none"
        default-in-u1: "すべて none を返す（並び替えなし）。U5 が本物の実装に差し替える"
    SuggestionJudge:        # 提供：Suggestion（U1）／使う：MealPlan、ShoppingList
      pickCandidates:
        in: { context: CallContext, filter: "time/effort/moodTags", exclude: "処理済み" }
        out: "Dish[]（除外済み・並び替え済み）"
      listPicked:
        in: { context: CallContext }
        out: "PickedItem[]"
    ShoppingListCompose:    # 提供：ShoppingList（U3）／使う：MealPlan（U4）。ユニットの依存（U4 → U3）の向きに合わせる（ADR-010）
      composeFromIngredients:
        in: { context: CallContext, source: "picked | mealPlan(planId)", ingredients: "Ingredient[]（「作らない」の日の料理は含めない）" }
        out: "ShoppingList（同じ材料・同じ単位は合算。未入力の項目は「材料の入力が必要」を付ける）"
      note: 献立（U4）が材料を渡す。買い物リスト（U3）は、献立を知らない
    ImageRequest:           # 窓口の定義と既定の実装：U1（持ち主）／本物の実装：ImageGen（U6）／使う：Dish（U1。非同期）
      default-in-u1: "requestGeneration は何もせず、getStatus は none を返す。U6 が本物の実装に差し替える"
      requestGeneration:
        in: { context: CallContext, dishId: string }
        out: "accepted（すぐに返す。画像はあとで取りに行く）"
      getStatus:
        in: { context: CallContext, dishId: string }
        out: "none | pending | ready | failed（+ 画像の場所）"
      deleteForDish:
        in: { context: CallContext, dishId: string }
        out: "accepted"
  rules:
    - 一括で聞く：項目の一覧をまとめて渡し、項目ごとの問い合わせをしない（候補を作るたび）
    - 提供する側は、渡された householdId のデータにしか届かない
    - 同期の呼び出し（この C2）は再試行しない（アプリの中で、失敗はそのまま上へ返す）。再送があるのは、C3 の出来事だけ
    - 先に作るユニット（U1）が、窓口の定義と既定の実装（何もしない、空を返す）を持つ。後から作るユニット（U2、U5、U6）は、本物の実装を足すだけにして、並行してビルドできるようにする
    - 日付は、日本時間（Asia/Tokyo）で扱う（「今日まで」の判定を含む）
```

## C3：イベント（アプリの中の出来事）

AsyncAPI の形で決める。仕組みは、データベースに記録してから配る（Q3 A）。外部のメッセージ基盤は使わない。

```yaml
asyncapi: 2.6.0
info:
  title: 献立ストレス緩和アプリ 内部イベント
  version: 1.0.0
defaultContentType: application/json
channels:
  account.deleted:
    description: アカウントが削除された（受け手：家族グループ。そのアカウントのメンバーを外し（退会の印と、名前を消す。ADR-009）、member-left を出す。最後の 1 人だったら、グループを削除して household.deleted を出す）
    publish:
      message:
        $ref: '#/components/messages/AccountDeleted'
  household.created:
    description: グループが作られた（受け手：料理が初期データ 30 件を登録）
    publish:
      message:
        $ref: '#/components/messages/HouseholdCreated'
  household.member-left:
    description: メンバーが抜けた（受け手：好き嫌いが、その人の嫌いな食材を外す）
    publish:
      message:
        $ref: '#/components/messages/MemberLeft'
  household.deleted:
    description: グループが削除された（受け手：料理、好き嫌い、作った記録、候補の提案、献立、買い物リスト、画像づくり（登録画像と AI の画像の実体）、招待。自分のデータを消す）
    publish:
      message:
        $ref: '#/components/messages/HouseholdDeleted'
components:
  messages:
    AccountDeleted:
      payload:
        type: object
        required: [eventId, occurredAt, accountId]
        properties:
          eventId: { type: string, description: 一意の ID。受け側が二度受けても結果が同じになるための目印 }
          occurredAt: { type: string, format: date-time }
          accountId: { type: string }
    HouseholdCreated:
      payload:
        type: object
        required: [eventId, occurredAt, householdId]
        properties:
          eventId: { type: string }
          occurredAt: { type: string, format: date-time }
          householdId: { type: string }
    MemberLeft:
      payload:
        type: object
        required: [eventId, occurredAt, householdId, memberId]
        properties:
          eventId: { type: string }
          occurredAt: { type: string, format: date-time }
          householdId: { type: string }
          memberId: { type: string }
    HouseholdDeleted:
      payload:
        type: object
        required: [eventId, occurredAt, householdId]
        properties:
          eventId: { type: string }
          occurredAt: { type: string, format: date-time }
          householdId: { type: string }
x-delivery:
  guarantee: 少なくとも 1 回届く（at-least-once）
  receiver: 同じ eventId を二度受けても、結果が同じ（冪等）
  failure: 届かなかったときは、後から整える（再送。初回アクセス時に初期データがなければ登録する等）
  ordering: 出来事の順序は保証しない。受け手は、順序に依存しないように作る（member-left と household.deleted が続けて来ても、結果が同じ）
  resend: 再送は出来事だけの話で、C2 の同期の呼び出しは再試行しない
  note: グループが削除された出来事の受け口は、各ユニットが自分で作る（U7 は出す側）
```

## C4：生成 AI サービス（外部）

画像づくり（U6）が呼ぶ。サービスは未決定（要件の OQ7）なので、**自分たちの側の窓口**を決め、サービスをあとから入れ替えられるようにする。

```yaml
shared-schema:
  port: ImageGeneratorPort
  operations:
    generate:
      in: "prompt（料理名、材料から作る短い文）, size"
      out: "画像のバイト列 または エラー"
  policy:
    processing: 裏の処理（非同期）で行う。画面の応答は待たせない（NFR2 の候補 1 件の取得などに影響しない）
    timeout: 30 秒（待つ上限。暫定の値）
    retry: 最大 3 回、間隔 5 秒・15 秒・45 秒（暫定の値。最悪で約 3 分かかるが、裏で行う。だめなら failed にして、色の枠を出し続ける）
    cost-guard: 費用と回数の上限を、画像づくりの中で管理する（上限を超えたら作らない）
  label: 作った画像には「AI が作ったイメージ」の印を付ける
```

## C5：メール送信サービス（外部）

アカウント（U7）が呼ぶ。パスワード再設定の案内を送る。

```yaml
shared-schema:
  port: MailSenderPort
  operations:
    send:
      in: "to, subject, body"
      out: "accepted または エラー"
  policy:
    processing: 裏の処理で行う。画面の応答（202）は、送信の完了を待たない
    timeout: 10 秒（暫定の値）
    retry: 最大 3 回、間隔 5 秒・15 秒・45 秒（暫定の値）
    privacy: メールアドレスが登録済みかどうかを、画面の答えで区別しない（C1 の /auth/password-reset は常に 202）
```

## 共通の決まり

- **エラーの形**：種類のコード（`code`）と、利用者に見せる短い文（`message`）を返す。内部の呼び出しは、エラーをそのまま上へ返し、再試行しない。外部サービスだけ、上の C4、C5 の再試行をする（Q5 A）。
- **版の管理（Q4 A）**：内部の契約（C2、C3）は、同じリポジトリで、同時に直す。画面とサーバーの API（C1）だけ、住所に版を付ける（`/api/v1`）。外に公開する API はないため、版を上げるのは、画面とサーバーを別々に更新したくなったときに限る。
- **変更の取り決め**：
  - 持ち主のユニットが、自分の契約の仕様を管理する。
  - 追加の変更（項目を足す）は安全にする：使う側は、知らない項目を無視する。
  - 壊す変更（項目を消す、意味を変える）は、使う側のユニットと同時に直す。同じリポジトリなので、1 回の変更でそろえる。
- **所属の確認（ADR-005）**：householdId は、サーバーがセッションから決める。リクエストの本文や URL では、受け取らない。契約ごとに、「他のグループの ID を渡しても何も届かない」ことを確かめるテストを置く。

## 未解決の点

| 契約 | 質問 | 止めるもの |
|---|---|---|
| C1 | 認証の方式：Cookie のセッション（案）か、トークンか。CSRF 対策の方式 | U1（ログイン） |
| 全体 | 性能の目標（NFR2：候補の取得 2 秒以内、献立の提案 3 秒以内）を、契約の応答時間の目標として、どの窓口で測るか（候補 1 件の取得、献立の提案） | U1、U4 |
| C1 | 一覧の大きさ（ページ分け）が必要か。項目 200 件以下の想定なので、最初は不要とする案 | U1、U5 |
| C1 | 共有メニューから保存する窓口の形（要件の OQ2） | U1（US1.3） |
| C4 | 生成 AI のサービス、費用と回数の上限、安全面（要件の OQ7） | U6 |
| C4 | 画像のできあがりを取りに行く方法：画面が一定時間ごとに確認するか、次に開いたときに取るか | U6 |
| C3 | 届かなかった出来事を後から整える具体的な方法と、頻度 | U1（初期データ）、U2（好き嫌い）、U7 |
| C5 | メール送信のサービス | U7 |
| C1 | 出来事で消す処理のあいだの、画面の見え方（グループ削除の暫定の案）。1st バージョンのあとで見直す | U7 |
