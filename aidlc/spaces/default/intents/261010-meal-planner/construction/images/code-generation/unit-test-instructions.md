# 単体テストの手順：U6 images

## 方針

- 標準の戦略。手法は test-after。通し版の後の変更なので、行カバレッジ 80% 以上を目標にする（`team.md`）。
- U1 の Vitest の設定とテスト用の補助（PGlite のメモリ上のデータベース）をそのまま使う。ファイル保管は、テストでは一時ディレクトリ（またはメモリ上の実装）に差し替える。時刻（pending の期限）も差し替える。

## このユニットだけのテストの実行コマンド

| 層 | 実行コマンド |
|---|---|
| データモデル | `npx vitest run src/db/__tests__/images-schema.test.ts` |
| リポジトリ | `npx vitest run src/repo/images/__tests__` |
| 業務ロジック | `npx vitest run src/domain/images/__tests__` |
| API | `npx vitest run src/api/routes/__tests__/images.test.ts` |
| 画面 | `npx vitest run src/ui/images/__tests__` |
| U6 全体 | `npx vitest run src/db/__tests__/images-schema.test.ts src/repo/images/__tests__ src/domain/images/__tests__ src/api/routes/__tests__/images.test.ts src/ui/images/__tests__` |

## 必ず入れるテスト

- 5MB ちょうどは登録でき、5MB を超えるものは拒否される。画像でないファイル（拡張子だけ画像）は拒否される。
- 登録した画像があれば、AI の画像は表示されない。登録がなければ「AI が作ったイメージ」の印つきのダミーが出る。
- 他のグループの画像は、URL を知っていても見られない（取得時にグループを確認）。
- 作成中（pending）が 10 分たつと、再要求できる。
- 新規保存のあと画像が入力エラーでも、料理は保存済みで、画像だけ再登録できる。
