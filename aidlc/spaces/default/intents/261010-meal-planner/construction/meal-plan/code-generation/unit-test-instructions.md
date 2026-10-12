# 単体テストの手順：U4 meal-plan

## 方針

- 標準の戦略（コンポーネントあたり 5〜8 件の単体テスト＋主要な境界の統合テスト）。手法は test-after。通し版の後の変更なので、行カバレッジ 80% 以上を目標にする（`team.md`）。
- U1 の Vitest の設定とテスト用の補助（PGlite のメモリ上のデータベース、乱数の差し替え）をそのまま使う。U1 の既存のテスト（候補の取得）は緑のままにする。

## このユニットだけのテストの実行コマンド

| 層 | 実行コマンド |
|---|---|
| データモデル | `npx vitest run src/db/__tests__/mealplan-schema.test.ts` |
| リポジトリ | `npx vitest run src/repo/mealplan/__tests__` |
| 業務ロジック | `npx vitest run src/domain/mealplan/__tests__` |
| API | `npx vitest run src/api/routes/__tests__/mealplan.test.ts` |
| 画面 | `npx vitest run src/ui/mealplan/__tests__` |
| U4 全体 | `npx vitest run src/db/__tests__/mealplan-schema.test.ts src/repo/mealplan/__tests__ src/domain/mealplan/__tests__ src/api/routes/__tests__/mealplan.test.ts src/ui/mealplan/__tests__` |

## 必ず入れるテスト

- 初期データだけのグループで、乱数列を変えて何回提案しても、空欄 0 件、同じ料理は 1 回まで、同じ食材の種類が 3 日続かない（V1）。
- 除外した食材を含む料理は含まれない（V2）。「選んだもの」を除かず、料理が 5 件だけなら 5 日分が埋まり 2 日が空欄（V3）。
- 「作らない」を設定した日は skip で、空きの数に数えない（V4）。日のやり直しは他の 6 日を動かさない（V6）。週全体のやり直しは作らない日を保ち、直前と同じ並びにしない（V7）。
- 保存してから呼び出して変更しても、保存済みの元は変わらない（V8）。
- 作らない日がある献立の買い物リストに、その日の料理の材料が渡されない（V10）。
- 他のグループの献立は読み書きできない。CSRF の欠落は拒否される。保存済みの献立への変更は拒否される。
- U1 の既存の候補のテストが緑のまま（`includePicked` を指定しない呼び出しは変わらない）。
