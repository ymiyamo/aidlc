# ユニットの依存（DAG）

ユニットの間の「何が何に頼るか」（依存）を記録する。ここに書くのは依存の形だけで、作る順番や、重要な経路（クリティカルパス）は書かない。それは次の Delivery Planning が、経済的な理由（価値の大きさ、リスク）で決める。

## 依存の一覧（A が B に頼る）

| ユニット | 頼る先 | 頼る理由 |
|---|---|---|
| U1 最小の通し版 | なし | 土台 |
| U2 好き嫌いと絞り込み | U1 | 候補の提案の土台と、グループ・メンバーを使う |
| U3 買い物リスト | U1、U2 | 選んだもの（U1）を使う。U2 への依存は、技術上は必須ではない（OQ1） |
| U4 献立 | U1、U2、U3 | 候補の判定（除外、U2）と、料理（U1）を使う。この献立の買い物リストは U3 を使う |
| U5 作った記録 | U1 | 項目（料理）を指す。候補の並び順への反映は、U1 の候補の提案に足す |
| U6 画像 | U1 | 項目（料理）に画像を足す |
| U7 グループとアカウントの管理 | U1 | グループとアカウントの土台に足す |

## 依存の図（DAG）

PlantUML のコードは、ここでは作っていない（必要になれば、`component-diagram.puml` のように別に作る）。文字で表すと次のとおり。**矢印は「頼る側 → 頼られる側」**（edge block の `depends_on` と同じ向き）。

```
U2 ─▶ U1
U3 ─▶ U1
U3 ─▶ U2
U4 ─▶ U1
U4 ─▶ U2
U4 ─▶ U3
U5 ─▶ U1
U6 ─▶ U1
U7 ─▶ U1
```

- 循環はない。
- 土台は U1（どのユニットも、直接または間接に U1 に頼る）。

## 連携する場所（integration points）

向きは「頼る側のユニット → 頼られる側のユニット」で書く（edge block の `depends_on` と同じ）。

| ユニット間 | 連携する場所 | 形 |
|---|---|---|
| U2 → U1 | U2 の好き嫌いの除外一覧を、U1 の候補の提案が問い合わせて使う（U2 が U1 の候補の提案を拡張する） | アプリの中の関数呼び出し（同期） |
| U3 → U1 | 買い物リストが、選んだものと、料理の材料を取る | 同期 |
| U4 → U3 | 献立が、買い物リストの集計を使う（この献立の買い物リスト） | 同期 |
| U5 → U1 | 作った記録が、料理の存在を確かめる。作った記録の最新の感想を、U1 の候補の提案が問い合わせて使う（U5 が拡張する） | 同期 |
| U6 → U1 | 料理が、画像づくりに依頼する（料理から画像づくりへ）。画像は料理が取りに行く。画像づくりを足すのが U6 | 非同期 |
| U7 → U1 | U7 が出す出来事（メンバーが抜けた、グループが削除された）を、各コンポーネントが受ける。受ける側の受け口は、各ユニットが自分で作る | 出来事 |

連携の形の細部（呼び出しの形、出来事の形）は、次の Contract Design で決める。

## 依存から導かれる事実（順番の推奨ではない）

- U2、U5、U6、U7 は、お互いの間に辺がない。U1 以外の共通の依存がないため、並行して作ることが依存の上では可能。
- U3 は U1、U2 に、U4 は U1、U2、U3 に依存する。
- 実際にどの順で作るかは、Delivery Planning が決める。

## 最小の通し版（skeleton）について

U1 は、DAG で最初のユニットであり、最小の通し版である。ほかのユニットがなくても、次の流れが端から端まで動く。
ログイン → グループ作成（初期データ 30 件が入る）→ URL と料理名の保存 → 買い物前の画面で候補を 1 件ずつ見る → これにする／パス。
除外（U2）がなくても、すべての項目が候補になるので動く。画像（U6）がなくても、色の枠で表示できる。

## 機械が読む部分（edge block）

```yaml
units:
  - name: skeleton
    kind: service
    depends_on: []
  - name: taste-filter
    kind: service
    depends_on: [skeleton]
  - name: shopping-list
    kind: service
    depends_on: [skeleton, taste-filter]
  - name: meal-plan
    kind: service
    depends_on: [skeleton, taste-filter, shopping-list]
  - name: cook-log
    kind: service
    depends_on: [skeleton]
  - name: images
    kind: service
    depends_on: [skeleton]
  - name: account-admin
    kind: service
    depends_on: [skeleton]
```

ユニット名は、U1〜U7 に次のように対応する。skeleton＝U1、taste-filter＝U2、shopping-list＝U3、meal-plan＝U4、cook-log＝U5、images＝U6、account-admin＝U7。
