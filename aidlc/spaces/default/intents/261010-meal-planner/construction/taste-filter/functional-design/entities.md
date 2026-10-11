# エンティティ設計：U2 好き嫌いと絞り込み

技術を決めない設計です。U2 が新しく持つ「覚えておく情報のまとまり」（エンティティ）は **1 つだけ**（DislikedIngredient）です。絞り込みの条件は、画面が持つ一時的な情報で、エンティティにしません。正（source of truth）は下の yaml ブロックです。

## 根拠（Sources）

- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U2 の節、`unit-of-work-story-map.md`
- [components] `components.md` の Taste（DislikedIngredient）と Suggestion の記述
- [memory] ADR-004（好き嫌いは独立したコンポーネント）、ADR-005（所属確認）、ADR-007（出来事は at-least-once、重複しても安全）、ADR-009（ID だけの参照）
- [U1] U1 の `entities.md`（Dish、Member、PickedItem の形）

## エンティティの定義

```yaml
entities:
  - name: DislikedIngredient
    component: Taste
    description: メンバーが登録した「嫌いな食材」1 件。グループの全員の候補・献立から、この食材を含む料理を外すために使う。アレルギーではない（FR13 は作らない）。
    attributes:
      - { name: dislikeId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId, note: "ID だけの参照（ADR-009）。すべての問い合わせは、この値で絞る（ADR-005）" }
      - { name: memberId, type: id, required: true, references: Member.memberId, note: "登録したメンバー。ID だけの参照（ADR-009）。人の参照は memberId だけで、accountId は持たない" }
      - { name: ingredientName, type: text, required: true, min: 1, max: 50, constraints: "前後の空白を除いた文字列。大文字小文字・全角半角・ひらがな/カタカナ/漢字の読み替えはしない（正規化しない。US4.3、BR10.7）" }
      - { name: registeredAt, type: datetime, required: true }
    constraints:
      - "同じ memberId で、同じ ingredientName（完全一致）の DislikedIngredient は 1 件まで。同時に 2 件の登録が来ても 1 件にする（BR10.2）"
      - "1 人の memberId につき、最大 50 件（BR10.3）"
      - "householdId は、memberId が所属するグループと同じ（登録時に、入口で決めた値を使う。画面の入力からは決めない。BR10.23）"
    relationships:
      - { to: Member, cardinality: "n : 1", direction: "DislikedIngredient -> Member", note: "ID だけの参照。依存（矢印）にはしない（ADR-009）。メンバーが抜けたら、アプリ内の呼び出しで消す（BR10.21）。消えなかった分は、除外一覧を作るときに現在のメンバーの登録だけを使うので影響しない（BR10.6）" }
      - { to: Household, cardinality: "n : 1", direction: "DislikedIngredient -> Household", note: "ID だけの参照。グループが削除されたら、アプリ内の呼び出しで消す（BR10.22）" }

# U2 が読むだけのエンティティ（持ち主は他のコンポーネント。値は変えない）
reads:
  - { entity: Dish, owner: Dish, attributes_used: [dishId, householdId, cookTime, effort, moodTags, ingredients, deletedAt], note: "候補の絞り込みと除外の判定に使う。U1 の形のまま（cookTime は within15 / within30 / over30）" }
  - { entity: DishIngredient, owner: Dish, attributes_used: [ingredientName], note: "除外の照合の対象は、材料名だけ（分量・単位・メモは見ない）" }
  - { entity: PickedItem, owner: Suggestion, attributes_used: [dishId], note: "U1 の候補は「選んだもの」を除く（U1 BR4.1）。おまかせは除かない（BR10.16）" }
```

## 持たないもの（エンティティにしない）

- **絞り込みの条件**（調理時間、手間、気分のタグ）：画面（クライアント）が一時的に持つ。サーバーは保存しない。「見た料理の一覧」（U1 BR4.3）と同じ扱い（BR10.14）。
- **グループの除外一覧**（ExcludedIngredientList）：グループの現在のメンバー（退会していない人）の DislikedIngredient だけから、そのつど作る一覧。保存しない（BR10.6）。
- **気分のタグの選択肢**：グループの削除済みでない料理が持つ moodTags を集めたもの。そのつど作る。保存しない（BR10.10）。
- **外で探す検索語**：選んでいる条件から、そのつど作る文字列。保存しない（BR10.17）。
- **アレルギー**：作らない（FR13、US4.2 は Won't）。DislikedIngredient に「重さ」や「アレルギーの印」の項目を足さない。

## U1 の設計との関係

| U1 のもの | U2 での扱い |
|---|---|
| Dish.cookTime（within15 / within30 / over30） | 絞り込みの調理時間に使う。契約 C1・C2 に `longer`／`cookTimeBand` と書かれているが、U1 実装の over30／cookTime を正と確定する。契約の直しは、U2 のコード生成のときに contract-summary を直す後続作業とする |
| Dish.ingredientKind（上流 components.md） | U1 は持たず、U2 も使わない。食材の種類（同じ食材の種類は 3 日続けない）は U4 の機能設計で扱う |
| Member.leftAt / displayName | U2 は参照しない。人は memberId だけ（ADR-009）。退会は出来事（BR10.21） |
| PickedItem | U2 は変えない。除外が後から増えても、すでに選んだものは外さない（BR10.8） |

## 概要

| エンティティ | 持ち主コンポーネント | 一言で |
|---|---|---|
| DislikedIngredient | Taste | メンバーが登録した嫌いな食材 1 件 |
