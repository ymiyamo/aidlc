# エンティティ設計：U5 作った記録（cook-log）

技術を決めない設計です。「覚えておく情報のまとまり」（エンティティ）と、その関係を決めます。正（source of truth）は下の yaml ブロックです。

## 根拠（Sources）

- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U5 の節、`unit-of-work-story-map.md`（US6.2〜US6.6）
- [memory] `components.md`（CookLog の CookRecord）、ADR-005 所属確認、ADR-008 料理の論理削除、ADR-009 ID のみの参照
- [scope] `contract-summary.md`（CookRecord の入出力、C2 の CookLogImpression）
- [scope] U1 の `entities.md`（Dish、Member、用語の手本）

## エンティティの定義

```yaml
entities:
  - name: CookRecord
    component: CookLog
    description: 「この料理を、この日に作った」という 1 件の記録。1 つの料理に何件でも持てる（1 対多）。
    attributes:
      - { name: recordId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId, note: "ID だけの参照（ADR-009）。すべての問い合わせはこれで絞る（ADR-005）。ログイン状態から決め、入力では受け取らない" }
      - { name: dishId, type: id, required: true, references: Dish.dishId, note: "ID だけの参照（ADR-009）。Dish の中身は持たない。記録を作ったあとは変えない" }
      - { name: memberId, type: id, required: true, references: Member.memberId, note: "記録した人。ID だけの参照（ADR-009）。編集しても変わらない。退会後も残し、表示は「退会したメンバー」（BR2.5）" }
      - { name: cookedOn, type: date, required: true, constraints: "時刻は持たない日付。日本時間の今日まで。未来は不可（BR40.1）" }
      - { name: impression, type: enum, required: false, allowed: [again, never_again], note: "また作りたい / もう作りたくない。空は「感想なし」（BR40.2）" }
      - { name: cautionMemo, type: text, required: false, max: 1000, note: "料理中の注意点のメモ。空でもよい（BR40.3）" }
      - { name: createdAt, type: datetime, required: true }
      - { name: updatedAt, type: datetime, required: true }
    constraints:
      - "同じ householdId・同じ dishId・同じ cookedOn の CookRecord は、同時に 1 件まで。同時に 2 件の追加が来ても 1 件にする（BR40.4）"
      - "編集では、dishId・memberId・householdId を変えない。変えられるのは cookedOn・impression・cautionMemo だけ（BR40.8）"
      - "料理が論理削除されても CookRecord は消さない（BR40.11、ADR-008）。グループが削除されたときだけ、そのグループの CookRecord をすべて消す（BR40.21）"
      - "削除は物理削除（CookRecord には論理削除の印を持たない）。1 件を消しても、同じ料理の他の記録には影響しない（BR40.9）"
    relationships:
      - { to: Dish, cardinality: "n : 1", direction: "CookRecord -> Dish", note: "dishId だけを値として持つ（ADR-009）。1 つの料理に 0..n 件。料理が削除済みでも記録は残る" }
      - { to: Member, cardinality: "n : 1", direction: "CookRecord -> Member", note: "memberId だけを値として持つ（ADR-009）" }
      - { to: Household, cardinality: "n : 1", direction: "CookRecord -> Household", note: "householdId だけを値として持つ。問い合わせは必ず householdId で絞る（ADR-005）" }
```

## 画面・問い合わせの答えとして作るだけの情報（エンティティにしない）

保存はせず、CookRecord と Dish から、問い合わせのたびに作ります。

| 名前 | 内容 | 使うところ |
|---|---|---|
| 料理の記録まとめ | その料理の作った回数、記録の一覧（作った日の新しい順、感想、メモ） | 項目の詳細（BR40.7） |
| カレンダーの日 | 日付ごとの記録の件数、料理名（短く）、感想の印 | カレンダー（BR40.12） |
| 月の記録の一覧 | その月の記録を、作った日の新しい順に並べたもの | 一覧とカレンダーの下（BR40.13） |
| 項目ごとの最新の感想 | dishId → `again` / `never_again` / `none` の対応表 | 候補の並べ替え（BR40.19、契約 C2 の CookLogImpression） |

## 上流の名前との対応表

| 上流（components.md、contract-summary.md） | この設計 | 備考 |
|---|---|---|
| CookRecord.impression（`again` / `never_again`、空あり） | CookRecord.impression（同じ） | 同じ。C2 の「最新の感想」では、空を `none` と呼ぶ |
| CookRecord.cautionMemo | CookRecord.cautionMemo（最大 1000 文字） | 同じ。上限は料理のメモ（Dish.memo）と合わせた |
| CookRecord.cookedOn（日付） | CookRecord.cookedOn（同じ） | 日本時間の日付。時刻は持たない |
| CookRecord.memberId | CookRecord.memberId（同じ） | 表示用の `memberLabel` は保存せず、表示のとき BR2.5 で作る（BR40.23） |
| CookRecord.createdAt | CookRecord.createdAt、updatedAt | 編集の時刻のため updatedAt を足した |

## 概要

| エンティティ | 持ち主コンポーネント | 一言で |
|---|---|---|
| CookRecord | CookLog | 作った日の記録 1 件（料理に 1 対多）。感想とメモは任意 |
