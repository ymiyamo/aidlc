# チームの実践（Team Practices）

## Way of Working

トランクベース開発で進める。作業は `main` から切った短命ブランチ（1〜2 日で解決）で行い、`main` へ統合する。作業単位（Bolt）ごとにスカッシュマージして 1 コミットにまとめ、`main` の履歴を線形に保つ。

## Walking Skeleton

最初に、画面からデータ保存まで通しで動く最小の版（walking skeleton）を作り、各部品がつながることを確認してから機能を足していく。

## Testing Posture

- **Methodology**: test-after
- **Methodology evidence**: Q3 で A（実装してからテストを書く）を選択。組織の既定と同じ。
- **Ordering**: テスト可能な層を実装したあと、その層のテストを書いて実行する。
- 行カバレッジ 80% 以上の下限は、通し版（walking skeleton）の後に追加・変更するコードに適用する。通し版そのものには適用しない。CI でテストを実行してからマージする。

## Deployment

マージ時に検証環境へ自動デプロイする。本番は、技術リードとプロダクトオーナーの手動承認を経てからデプロイする。

## Code Style

言語標準の整形ツールと lint に従う（JS/TS なら Prettier と ESLint など）。CI で失敗した場合はマージできない。
