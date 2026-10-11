# エンティティ設計：U1 最小の通し版

技術を決めない設計です。「覚えておく情報のまとまり」（エンティティ）と、その関係を決めます。正（source of truth）は下の yaml ブロックです。

## 根拠（Sources）

- [Q1〜Q12] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U1 の節（アカウント、家族グループの作成、料理、候補の提案、初期データ）
- [memory] `components.md` / `decisions.md`（ADR-005 所属確認、ADR-007 出来事、ADR-008 料理の論理削除、ADR-009 ID のみの参照）

## エンティティの定義

```yaml
entities:
  - name: Account
    component: Account
    description: 登録した 1 人の利用者。ログインの単位。
    attributes:
      - { name: accountId, type: id, required: true, unique: true }
      - { name: email, type: text, required: true, unique: true, constraints: "メールアドレスの形式。比較は大文字小文字を区別しない（BR1.2）" }
      - { name: passwordDigest, type: text, required: true, constraints: "元のパスワードは保存しない。復元できない形で保存する（BR1.3）" }
      - { name: createdAt, type: datetime, required: true }
    relationships:
      - { to: Member, cardinality: "1 : 0..1", direction: "Account -> Member", note: "1 人は同時に 1 つのグループにしか入れない（Q4 A）。表示名は Account ではなく Member が持つ（上流 components.md に合わせる。アカウント削除で名前を消せるようにするため、ADR-009）" }
      - { to: LoginSession, cardinality: "1 : 0..n", direction: "Account -> LoginSession" }

  - name: LoginSession
    component: Account
    description: ログインしたままの状態。端末（ブラウザ）ごとに 1 つ。
    attributes:
      - { name: sessionId, type: id, required: true, unique: true, constraints: "推測できないランダムな値（BR1.5）" }
      - { name: accountId, type: id, required: true, references: Account.accountId }
      - { name: issuedAt, type: datetime, required: true }
      - { name: expiresAt, type: datetime, required: true, constraints: "issuedAt の 30 日後（Q2 A）" }
    constraints:
      - "期限切れ、またはログアウト済みの LoginSession では、どの操作もできない"

  - name: Household
    component: Household
    description: 家族のグループ。すべての共有データ（料理、選んだもの）の持ち主。
    attributes:
      - { name: householdId, type: id, required: true, unique: true }
      - { name: name, type: text, required: true, max: 50, default: "わが家" }
      - { name: createdAt, type: datetime, required: true }
    relationships:
      - { to: Member, cardinality: "1 : 1..n", direction: "Household -> Member" }
      - { to: Dish, cardinality: "1 : 0..n", direction: "Household -> Dish", note: "ID のみで参照（ADR-009）" }
      - { to: PickedItem, cardinality: "1 : 0..n", direction: "Household -> PickedItem" }

  - name: Member
    component: Household
    description: 「この人が、このグループのメンバーである」という所属（上流 components.md の Member）。他のコンポーネントは memberId だけを値として持つ。退会後も行を残し、名前を消す（ADR-009、U7 で使う）。
    attributes:
      - { name: memberId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId }
      - { name: accountId, type: id, required: false, references: Account.accountId, note: "アカウント削除（U7）で空になりうる" }
      - { name: displayName, type: text, required: false, min: 1, max: 50, default: "メールアドレスの @ より前", note: "退会・アカウント削除で消す。消えたら「退会したメンバー」と表示する（BR2.5）" }
      - { name: joinedAt, type: datetime, required: true }
      - { name: leftAt, type: datetime, required: false, constraints: "U1 では常に空。U7 の退会で設定される" }
    constraints:
      - "leftAt が空の Member は、1 つの accountId につき最大 1 件（BR2.1）。同時に 2 件作られても 1 件にする"

  - name: Dish
    component: Dish
    description: 保存した料理（URL の項目）。初期データの料理も同じ形で持つ。
    attributes:
      - { name: dishId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId }
      - { name: name, type: text, required: true, min: 1, max: 100 }
      - { name: url, type: text, required: true, max: 2000, constraints: "http または https で始まる（BR3.1）" }
      - { name: cookTime, type: enum, required: false, allowed: [within15, within30, over30], note: "15 分以内 / 30 分以内 / それ以上" }
      - { name: effort, type: enum, required: false, allowed: [easy, normal, hard], note: "楽 / ふつう / 頑張れる" }
      - { name: moodTags, type: list-of-text, required: false, max: 5, constraints: "1 つにつき 1〜20 文字、重複なし（Q8 A）" }
      - { name: ingredients, type: list-of-DishIngredient, required: false, note: "空でもよい（材料が未入力）" }
      - { name: memo, type: text, required: false, max: 1000 }
      - { name: isFavorite, type: boolean, required: true, default: false, note: "グループで共有（Q10 A）" }
      - { name: source, type: enum, required: true, allowed: [user, seed], default: user }
      - { name: seedKey, type: text, required: false, constraints: "source が seed のとき必須。初期データの識別子（BR3.12）" }
      - { name: createdBy, type: id, required: false, references: Member.memberId, note: "ID だけの参照（ADR-009）。初期データでは空" }
      - { name: createdAt, type: datetime, required: true }
      - { name: updatedAt, type: datetime, required: true }
      - { name: deletedAt, type: datetime, required: false, note: "空でなければ削除済み（論理削除、ADR-008）" }
    relationships:
      - { to: PickedItem, cardinality: "1 : 0..1", direction: "Dish -> PickedItem" }
    constraints:
      - "同じ householdId 内で、URL が同じ料理が複数あってもよい（Q6 A、利用者が選んだ場合のみ）"
      - "画像は持たない（U6 で追加する）"

  - name: DishIngredient
    component: Dish
    description: 料理の材料 1 行。料理の一部であり、単独では存在しない。
    attributes:
      - { name: ingredientName, type: text, required: true, max: 50 }
      - { name: amount, type: text, required: false, max: 30, note: "例：2、200、少々。数値に限らない（合算は U3 が扱う）" }
      - { name: unit, type: text, required: false, max: 20, note: "例：個、g" }

  - name: PickedItem
    component: Suggestion
    description: 「これにする」で選んだもの。グループで共有する（ADR 方針 Q2 A）。
    attributes:
      - { name: pickedId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId }
      - { name: dishId, type: id, required: true, references: Dish.dishId }
      - { name: memberId, type: id, required: true, references: Member.memberId, note: "選んだメンバー。ID だけの参照（ADR-009）" }
      - { name: pickedAt, type: datetime, required: true }
    constraints:
      - "同じ householdId で、同じ dishId の PickedItem は同時に 1 件まで。同時に 2 つの「これにする」が来ても 1 件にする（BR4.7）"
      - "削除済みの Dish を指す PickedItem は、取得のとき除いて返す（BR3.9）"
      - "選んだものは、外されるか、買い物リストを作り終える（U3 が通知）まで残る（Q12 A）"
```

## 画面側だけで持つ情報（エンティティにしない）

- **パスした料理の一覧と、見た順番**：クライアント（利用者の端末の画面）が持つ。サーバーは覚えない（BR4.3、BR4.5）。画面を閉じる、または「最初から見る」で消える。
- **初期データの雛形（SeedDishTemplate）**：データファイル（30 件）であり、エンティティではない。グループ作成時に、グループごとの Dish として複製される（BR3.12）。

## 上流の名前との対応表

U2〜U7 が上流（`components.md`）の名前で設計しても混乱しないよう、名前の違いを記録します。

| 上流（components.md） | この設計 | 備考 |
|---|---|---|
| Account.passwordHash | passwordDigest | 同じもの。失敗回数・ロック（failedLoginCount、lockedUntil）は U7 で足す |
| Member（memberId、displayName） | Member（同じ） | 名前を上流に合わせた。表示名は Member が持つ |
| Dish.cookTimeBand | Dish.cookTime | 同じ。U2 の絞り込みは cookTime を使う |
| Dish.isSample | Dish.source = seed | 同じ意味。seedKey で冪等に作るため、真偽ではなく種別にした |
| Dish.isDeleted | Dish.deletedAt | 同じ意味。いつ消したかも分かる |
| Dish.createdBy | Dish.createdBy（memberId） | 同じ |
| Dish.ingredientKind | （U1 では持たない） | 食材の種類は U2 の機能設計で扱う |
| Ingredient（ingredientId） | DishIngredient（ID なし） | 料理の一部で、単独では参照されないため ID は持たない。U3 は料理の材料の行を読むだけ |
| PickedItem.pickedId | PickedItem.pickedId | 同じ |

## 概要

| エンティティ | 持ち主コンポーネント | 一言で |
|---|---|---|
| Account | Account | 利用者 1 人 |
| LoginSession | Account | ログイン状態（30 日） |
| Household | Household | 家族のグループ |
| Member | Household | グループへの所属と表示名（退会後も行を残す） |
| Dish | Dish | 保存した料理 |
| DishIngredient | Dish | 料理の材料 1 行 |
| PickedItem | Suggestion | 「これにする」で選んだもの |
