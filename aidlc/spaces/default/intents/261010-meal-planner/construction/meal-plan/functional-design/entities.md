# エンティティ設計：U4 献立（meal-plan）

技術を決めない設計です。「覚えておく情報のまとまり」（エンティティ）と、その関係を決めます。正（source of truth）は下の yaml ブロックです。

## 根拠（Sources）

- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U4 の節、`components.md` の MealPlan（MealPlan、PlanDay）
- [memory] ADR-005（問い合わせは householdId で絞る）、ADR-008（料理は論理削除。過去の献立には残す）、ADR-009（他コンポーネントは ID だけを値として持つ）、ADR-010（献立が材料を渡す）
- [U1] `construction/skeleton/functional-design/entities.md`（Dish、DishIngredient、PickedItem）

## エンティティの定義

```yaml
entities:
  - name: MealPlan
    component: MealPlan
    description: 7 日分の献立 1 つ。「作業中」（保存していない）と「保存済み」がある。
    attributes:
      - { name: planId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId, note: "ID だけの参照（ADR-009）。すべての問い合わせはこれで絞る（ADR-005）" }
      - { name: startDate, type: date, required: true, note: "1 日目。利用者が指定、なければ提案を作った日（Q1 A）" }
      - { name: isSaved, type: boolean, required: true, default: false }
      - { name: name, type: text, required: false, max: 50, default: "「M/D からの献立」の形", note: "保存のとき付く（BR30.14）" }
      - { name: createdBy, type: id, required: true, references: Member.memberId, note: "ID だけの参照（ADR-009）。退会後も行は残り、表示は「退会したメンバー」（BR2.5）" }
      - { name: createdAt, type: datetime, required: true }
      - { name: updatedAt, type: datetime, required: true }
      - { name: savedAt, type: datetime, required: false, note: "isSaved が true のとき必須" }
    relationships:
      - { to: PlanDay, cardinality: "1 : 7", direction: "MealPlan -> PlanDay", note: "常に startDate から連続する 7 日。増減しない" }
      - { to: Household, cardinality: "n : 1", direction: "MealPlan -> Household", note: "ID だけの参照" }
    constraints:
      - "1 つのグループにつき、作業中（isSaved が false）の MealPlan は最大 1 件（BR30.15）"
      - "isSaved が true の MealPlan の日の内容は、「保存」の操作以外で変わらない（BR30.14、BR30.15）"

  - name: PlanDay
    component: MealPlan
    description: 献立の 1 日分。「料理が入っている」「作らない」「空欄」のどれか 1 つの状態を持つ。
    attributes:
      - { name: planDayId, type: id, required: true, unique: true }
      - { name: planId, type: id, required: true, references: MealPlan.planId }
      - { name: householdId, type: id, required: true, references: Household.householdId, note: "問い合わせを絞るため、親と同じ値を持つ（ADR-005）" }
      - { name: date, type: date, required: true, constraints: "同じ planId 内で重複しない。startDate から連続する 7 日" }
      - { name: dayStatus, type: enum, required: true, allowed: [assigned, skip, empty], default: empty, note: "料理あり / 作らない / 空欄" }
      - { name: dishId, type: id, required: false, references: Dish.dishId, note: "dayStatus が assigned のとき必須、それ以外は空。ID だけの参照（ADR-009）。削除済みの料理を指していてもよい（ADR-008）" }
      - { name: origin, type: enum, required: false, allowed: [suggested, assigned_by_user], note: "dayStatus が assigned のとき必須。システムが提案した / 利用者が手で割り当てた" }
      - { name: emptyReason, type: enum, required: false, allowed: [not_enough_dishes, no_valid_combination, not_proposed, dish_unavailable], note: "dayStatus が empty のとき必須。料理が足りない / 条件を満たす組み合わせがない / まだ提案していない（「作らない」解除直後など）/ 呼び出し時に料理が使えなくなっていた" }
    relationships:
      - { to: MealPlan, cardinality: "n : 1", direction: "PlanDay -> MealPlan" }
      - { to: Dish, cardinality: "n : 0..1", direction: "PlanDay -> Dish", note: "ID だけの参照。料理側は献立を知らない" }
    constraints:
      - "dayStatus が assigned: dishId と origin が必須、emptyReason は空"
      - "dayStatus が skip: dishId、origin、emptyReason はすべて空（BR30.10）"
      - "dayStatus が empty: dishId と origin は空、emptyReason が必須"
      - "同じ MealPlan の中で、同じ dishId の assigned は 3 件以上にならない（BR30.3）"
```

## 他のユニットに求める追加（このユニットでは作らない・変えない）

**追加の依頼その 2（献立用の候補の取得）**：U1 の BR4.1 の「選んだものを除く」は買い物前の 1 件ずつの表示専用です。献立の母集団は「削除済みでない全部の料理（除外・並び替え後）」で、選んだものを除きません。U4 の Code Generation の作業として、U1 側（`src/repo/dishes.ts` の `listCandidateIds`、`src/domain/suggestion.ts`）に、選んだものを除かない候補の一覧を返す入口（例：`includePicked` の指定）を足します（BR30.2）。

U1 のエンティティ Dish に、U4 が使う項目が 1 つ足りません。Dish の持ち主は料理コンポーネント（U1）なので、**追加は Code Generation で料理側に行う変更**として、ここに記録します（BR30.2、BR30.4、BR30.19）。

```yaml
external_extensions:
  - target: Dish
    owner_component: Dish
    added_attribute: { name: ingredientKind, type: enum, required: false, allowed: [meat, fish, vegetable, egg_soy, other], note: "主な食材の種類を 1 つ。肉 / 魚 / 野菜 / 卵・大豆 / その他。未入力でもよい（FR5.4）" }
    reason: "同じ種類が 3 日続かない判定（AC5.1.3）に必要。初期データ 30 件に付ける（AC9.1.6）。上流 components.md の Dish.ingredientKind に対応"
```

## 画面側だけで持つ情報（エンティティにしない）

- **割り当て候補の「選んだもの」**：Suggestion（U1）が持つ PickedItem を、問い合わせて読む（BR30.16）。U4 は複製しない。
- **提案の探索の途中経過**：その場の計算で、保存しない。

## 上流の名前との対応表

| 上流（components.md） | この設計 | 備考 |
|---|---|---|
| MealPlan（planId、householdId、startDate、isSaved、name、createdAt） | MealPlan（同じ＋createdBy、updatedAt、savedAt） | createdBy は人の参照（memberId）として追加。他は同じ |
| PlanDay（planDayId、planId、date、isSkipDay、dishId） | PlanDay（dayStatus、origin、emptyReason を追加。householdId も持つ） | isSkipDay は dayStatus が skip であることに置き換え。空欄の理由と、手割り当てか提案かを区別するため |
| Dish.ingredientKind | Dish.ingredientKind（追加の依頼） | U1 は持たなかった。上の「他のユニットに求める追加」参照 |

## 概要

| エンティティ | 持ち主コンポーネント | 一言で |
|---|---|---|
| MealPlan | MealPlan | 7 日分の献立 1 つ（作業中 / 保存済み） |
| PlanDay | MealPlan | 献立の 1 日分（料理あり / 作らない / 空欄） |
