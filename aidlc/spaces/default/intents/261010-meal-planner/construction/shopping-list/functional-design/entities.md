# エンティティ設計：U3 買い物リスト
技術を決めない設計です。「覚えておく情報のまとまり」（エンティティ）と、その関係を決めます。正（source of truth）は下の yaml ブロックです。

## 根拠（Sources）
- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U3 の節（選んだものの一覧、材料の集計、材料未入力の案内、チェックの保存）
- [scope] `components.md` の ShoppingList / ShoppingItem、`contract-summary.md` の ShoppingListCompose
- [memory] ADR-005（householdId で絞る）、ADR-007（出来事は重複しても安全）、ADR-008（料理は論理削除）、ADR-009（ID だけの参照）、ADR-010（献立が材料を渡す）
- [scope] U1 の `entities.md`（PickedItem、Dish、DishIngredient、Member）

## エンティティの定義
```yaml
entities:
  - name: ShoppingList
    component: ShoppingList
    description: 買い物リスト 1 つ。グループで共有する。「選んだもの」から作るリスト（picked）と、献立から渡された材料で作るリスト（mealPlan）がある。
    attributes:
      - { name: listId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId, note: "すべての問い合わせはこの値で絞る（ADR-005）" }
      - { name: source, type: enum, required: true, allowed: [picked, mealPlan], note: "picked = 「選んだもの」から作る。mealPlan = 献立（U4）が渡した材料から作る（ADR-010）" }
      - { name: sourcePlanId, type: id, required: false, note: "source が mealPlan のとき必須。献立の ID。ID だけの参照（ADR-009）。U3 は献立の中身を知らない" }
      - { name: status, type: enum, required: true, allowed: [active, completed], default: active, note: "作成中 / 完了（BR20.13）" }
      - { name: createdAt, type: datetime, required: true }
      - { name: completedAt, type: datetime, required: false, constraints: "status が completed のとき必須" }
      - { name: completedBy, type: id, required: false, references: Member.memberId, note: "完了した人。ID だけの参照（ADR-009）。退会後は「退会したメンバー」と表示（BR2.5）" }
      - { name: unpickDishIds, type: list-of-id, required: false, note: "完了時に確定する「選んだものから外す対象」の dishId の一覧（重複なし）。source が picked のとき、完了と同時に保存する（BR20.13）。外し残しの目印" }
      - { name: unpickDone, type: boolean, required: false, default: false, note: "外す処理が全部終わったか。false のうちは外し残し。source が picked で completed のときだけ意味を持つ（BR20.13）" }
    relationships:
      - { to: ShoppingItem, cardinality: "1 : 0..n", direction: "ShoppingList -> ShoppingItem" }
      - { to: Household, cardinality: "n : 1", direction: "ShoppingList -> Household", note: "ID のみで参照（ADR-009）" }
    constraints:
      - "同じ householdId で、source が picked かつ status が active のリストは同時に 1 件まで。同時に 2 つの「開く」が来ても 1 件にする（BR20.2）"
      - "source が mealPlan のリストは、sourcePlanId ごとに active を 1 件まで（BR20.14）"

  - name: ShoppingItem
    component: ShoppingList
    description: 買い物リストの 1 行。材料の 1 行（ingredient）、または「材料の入力が必要」の知らせの 1 行（needsInput）。リストの一部であり、単独では存在しない。
    attributes:
      - { name: itemId, type: id, required: true, unique: true }
      - { name: listId, type: id, required: true, references: ShoppingList.listId }
      - { name: householdId, type: id, required: true, references: Household.householdId, note: "リストと同じ値。チェックの更新も、この値で絞る（ADR-005）" }
      - { name: lineKey, type: text, required: true, constraints: "同じリストの中で一意。行の同一性を決める（BR20.5〜BR20.8）。同期のとき、同じ lineKey の行を同じ行とみなし、チェックを引き継ぐ（BR20.11）" }
      - { name: kind, type: enum, required: true, allowed: [ingredient, needsInput], default: ingredient }
      - { name: ingredientName, type: text, required: false, max: 50, constraints: "kind が ingredient のとき必須。前後の空白を除いた値" }
      - { name: unit, type: text, required: false, max: 20, note: "前後の空白を除いた値。空は「単位なし」" }
      - { name: amountKind, type: enum, required: false, allowed: [numeric, text, none], note: "numeric = 数として扱える分量、text = 数でない分量（少々など）、none = 分量が空。kind が ingredient のとき必須" }
      - { name: amountNumber, type: decimal, required: false, constraints: "amountKind が numeric のとき必須。10 進の小数として正確に足す（BR20.5）。0 より大きい" }
      - { name: amountText, type: text, required: false, max: 30, note: "amountKind が text のとき、元の書き方。numeric のときは表示用に amountNumber から作る" }
      - { name: sourceDishIds, type: list-of-id, required: true, min: 1, note: "この行の元になった料理の dishId（重複なし）。ID だけの参照（ADR-009）。削除済みの料理でも残す（ADR-008）" }
      - { name: checked, type: boolean, required: true, default: false, note: "needsInput の行は常に false で、チェックできない（BR20.8）" }
      - { name: checkedBy, type: id, required: false, references: Member.memberId, note: "最後にチェックを付けた人。ID だけの参照（ADR-009）" }
      - { name: checkedAt, type: datetime, required: false }
    relationships:
      - { to: ShoppingList, cardinality: "n : 1", direction: "ShoppingItem -> ShoppingList" }
      - { to: Dish, cardinality: "n : 1..n", direction: "ShoppingItem -> Dish", note: "sourceDishIds による ID のみの参照（ADR-009）" }
    constraints:
      - "lineKey は同じ listId の中で一意（BR20.5）"
      - "kind が needsInput の行は、sourceDishIds が 1 件（その料理）で、checked は常に false（BR20.8）"
      - "numeric の行は、同じリストの中で、ingredientName と unit が同じものは 1 行だけ（BR20.5、BR20.6）"
```

## 行の同一性（lineKey）の考え方
技術を決めない説明です。値の作り方は `rules.md` が正です。

| 行の種類 | 同一性の決め手 | 備考 |
|---|---|---|
| 数として扱える分量 | 材料名 + 単位 | 同じ材料・同じ単位は 1 行（合算）。単位が違えば別の行 |
| 数でない分量 / 分量が空 | 材料名 + 単位 + 分量の書き方 + 料理 | 料理ごとに別の行（Q3 A） |
| 材料の入力が必要 | 料理 | 材料が 0 行の料理 1 つにつき 1 行 |

## 画面側だけで持つ情報（エンティティにしない）
- **リストの並び**：表示のたびに、決めた順（BR20.9）で並べる。順番は保存しない。
- **「空です」の案内**：行が 0 件のときに画面が出す表示（BR20.12）。保存しない。

## 上流の名前との対応表
| 上流（components.md） | この設計 | 備考 |
|---|---|---|
| ShoppingList（listId、householdId、createdAt） | ShoppingList（同じ + source、sourcePlanId、status、completedAt、completedBy） | 「選んだもの」用と献立用の区別、完了の状態を足した |
| ShoppingItem.quantity | amountKind、amountNumber、amountText | 数と数でない分量を区別するため分けた |
| ShoppingItem.unit | unit | 同じ |
| ShoppingItem.checked | checked（+ checkedBy、checkedAt） | 誰がいつ付けたかを足した |
| ShoppingItem.sourceDishId（1 件） | sourceDishIds（1 件以上） | 合算した行は複数の料理から来るため、一覧にした |
| ShoppingItem.ingredientName | ingredientName | 同じ。needsInput の行は持たない |

## 概要
| エンティティ | 持ち主コンポーネント | 一言で |
|---|---|---|
| ShoppingList | ShoppingList | 買い物リスト 1 つ（作成中 / 完了） |
| ShoppingItem | ShoppingList | リストの 1 行（材料、または「材料の入力が必要」） |
