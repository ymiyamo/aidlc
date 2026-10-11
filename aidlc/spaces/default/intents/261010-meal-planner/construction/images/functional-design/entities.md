# エンティティ設計：U6 画像

技術を決めない設計です。正（source of truth）は下の yaml ブロックです。

## 根拠（Sources）

- [Q1〜Q5] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U6 の節（含むコンポーネント：画像づくり（全体）、料理（登録画像））
- [memory] `components.md` / `decisions.md`（ADR-005 所属確認、ADR-008 論理削除、ADR-009 ID だけの参照）、`contract-summary.md`（C2 ImageRequest、C4 ImageGeneratorPort）

## 通し版の方針

- 利用者が登録する画像（RegisteredImage）は本実装する。
- 生成 AI は未決定（OQ7）のため、C4 の ImageGeneratorPort の後ろに、ローカルで作る固定の絵（ダミー）を置く。サービスが決まったら、ポートの実装を差し替える（このユニットの設計は変わらない）。
- 画像の実体の保管は、ローカルではディスク、AWS ではオブジェクト保管、と抽象に扱う。エンティティは「保管の場所の名前（storageKey）」だけを持つ。

## エンティティの定義

```yaml
entities:
  - name: RegisteredImage
    component: Dish
    description: 利用者が登録した、料理の画像。1 つの料理に 1 枚（Q2 A）。
    attributes:
      - { name: imageId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId, note: "問い合わせは必ず householdId で絞る（ADR-005）" }
      - { name: dishId, type: id, required: true, references: Dish.dishId, unique: true, note: "ID だけの参照（ADR-009）。1 つの dishId に有効な画像は 1 枚" }
      - { name: contentType, type: enum, required: true, allowed: [jpeg, png, webp, gif], note: "ファイルの中身から判定した形式（BR60.1）" }
      - { name: byteSize, type: integer, required: true, min: 1, max: 5242880, note: "5MB = 5×1024×1024 バイト以下（BR60.2）" }
      - { name: storageKey, type: text, required: true, note: "保管の場所の名前。推測できない値。実体はローカルではディスク、AWS ではオブジェクト保管" }
      - { name: uploadedBy, type: id, required: false, references: Member.memberId, note: "memberId だけを持つ（ADR-009）。退会後も画像は残す" }
      - { name: uploadedAt, type: datetime, required: true }
    constraints:
      - "同じ dishId に有効な RegisteredImage は同時に 1 件まで。同時に 2 件の登録が来ても 1 件にする（置き換え、BR60.5）"
      - "householdId は Dish の householdId と一致する（BR60.6）"

  - name: GeneratedImage
    component: ImageGen
    description: 生成 AI（通し版ではダミー）が作る、料理の画像と、その作成の状態。登録画像がない料理にだけ使う。
    attributes:
      - { name: generatedImageId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId }
      - { name: dishId, type: id, required: true, references: Dish.dishId, unique: true, note: "ID だけの参照（ADR-009）。1 つの dishId に 1 件" }
      - { name: status, type: enum, required: true, allowed: [pending, ready, failed], default: pending }
      - { name: attemptCount, type: integer, required: true, default: 0, min: 0, max: 4, note: "最初の 1 回 + 再試行 3 回まで（C4）" }
      - { name: storageKey, type: text, required: false, note: "status が ready のとき必須" }
      - { name: contentType, type: enum, required: false, allowed: [jpeg, png, webp, gif], note: "status が ready のとき必須" }
      - { name: requestedAt, type: datetime, required: true, note: "pending が 10 分を超えたら failed とみなす（BR60.7）。再要求のときは更新する" }
      - { name: completedAt, type: datetime, required: false, note: "ready または failed になった時刻" }
    constraints:
      - "同じ dishId に GeneratedImage は 1 件まで。同じ料理への要求が重なっても 1 件にする（冪等、BR60.7）"
      - "status が ready のとき storageKey と contentType は必須。pending と failed のときは空"
      - "表示するのは RegisteredImage がないときだけ（BR60.3）。GeneratedImage 自体は、RegisteredImage があっても消さずに残してよい（外したとき、すぐ戻せる）"

  - name: SeedImage
    component: ImageGen
    description: 初期データの料理の画像。データファイルと並べた画像ファイルで、seedKey ごとに 1 枚。エンティティとして保存せず、読み取り専用の素材として扱う（Q4 A）。
    attributes:
      - { name: seedKey, type: text, required: true, unique: true, references: "Dish.seedKey（初期データのデータファイル）" }
      - { name: imageFile, type: text, required: true, note: "seedKey に対応する画像ファイル。形式と大きさは BR60.1、BR60.2 と同じ範囲" }
    constraints:
      - "グループごとに複製しない。全グループが同じ素材を参照する（BR60.9）"
      - "素材を差し替えると、プログラムを変えずに、以後の表示に反映される（AC9.1.8）"

  - name: DishImage
    component: ImageGen
    description: 画面に返す、料理の画像の状態（読み取り専用の見せ方。保存しない）。契約 C1 の DishImage に対応する。
    attributes:
      - { name: source, type: enum, required: true, allowed: [registered, generated, none], note: "どの画像か。registered = 利用者が登録、generated = 生成（初期データを含む）、none = 画像がない" }
      - { name: status, type: enum, required: true, allowed: [ready, pending, failed], note: "source が none のときは pending または failed（BR60.8）。契約の none は source = none で表す" }
      - { name: url, type: text, required: false, note: "画像を取る場所。status が ready のときだけ。グループの確認つき（BR60.6）" }
      - { name: isAiGenerated, type: boolean, required: true, note: "source が generated のとき true、それ以外は false（BR60.10）" }
      - { name: altText, type: text, required: true, note: "代わりの文字。料理名から作る（BR60.14）" }
```

## 上流・U1 との対応

| 上流 | この設計 | 備考 |
|---|---|---|
| 契約 C1 の DishImage（source: registered / generated / none） | DishImage | 同じ。契約の ImageRequest.getStatus の `none` は、DishImage.source = none で表す |
| components.md の「登録した画像」（Dish が持つ） | RegisteredImage | 持ち主は Dish のまま。U6 が作成と取得を実装する |
| components.md の「生成した画像」（ImageGen が持つ） | GeneratedImage | 同じ |
| U1 の Dish（画像を持たない） | Dish を変更しない | 画像は dishId だけで結びつける。U1 の Dish に項目は足さない |

## 概要

| エンティティ | 持ち主コンポーネント | 一言で |
|---|---|---|
| RegisteredImage | Dish | 利用者が登録した画像（1 料理に 1 枚） |
| GeneratedImage | ImageGen | 生成画像と作成の状態（pending / ready / failed） |
| SeedImage | ImageGen | 初期データの画像素材（読み取り専用） |
| DishImage | ImageGen | 画面に返す画像の状態（保存しない） |
