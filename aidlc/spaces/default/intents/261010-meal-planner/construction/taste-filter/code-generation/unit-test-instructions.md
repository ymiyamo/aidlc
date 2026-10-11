# 単体テストの手順：U2 taste-filter

## 方針

- 標準の戦略。手法は test-after。通し版の後の変更なので、行カバレッジ 80% 以上を目標にする（`team.md`）。
- U1 の Vitest の設定とテスト用の補助（PGlite のメモリ上のデータベース、乱数の差し替え）をそのまま使う。U1 の既存のテスト 121 件は緑のままにする（候補の取得の拡張で壊さない）。

## このユニットだけのテストの実行コマンド

| 層 | 実行コマンド |
|---|---|
| データモデル | `npx vitest run src/db/__tests__/taste-schema.test.ts` |
| リポジトリ | `npx vitest run src/repo/taste/__tests__` |
| 業務ロジック | `npx vitest run src/domain/taste/__tests__` |
| API | `npx vitest run src/api/routes/__tests__/taste.test.ts` |
| 画面 | `npx vitest run src/ui/taste/__tests__` |
| U2 全体 | `npx vitest run src/db/__tests__/taste-schema.test.ts src/repo/taste/__tests__ src/domain/taste/__tests__ src/api/routes/__tests__/taste.test.ts src/ui/taste/__tests__` |

## 必ず入れるテスト

- 「えび」を嫌いに登録すると、材料に「えび」を含む料理は候補に出ない。「海老」と書かれた料理は外れない（正規化しない）。
- 家族の誰かの登録でも除外される。退会したメンバーの登録は使わない。
- 調理時間と手間の両方を指定すると、両方に合うものだけ。件数が表示と一致する。
- 絞り込み 0 件のとき、案内が出る。おまかせは絞り込みなしで 1 件。
- 材料が未入力の料理は、除外されず「材料が未入力」と出る。
- 他のグループの登録・料理は見えない。CSRF の欠落は拒否される。
- U1 の既存の候補のテスト（パスした料理が出ない、選んだものが出ない、見終えた）が緑のまま。
