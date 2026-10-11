# 発見されたルール（Discovered Rules）

## Mandated

- ALWAYS 最初に最小の通し版（walking skeleton）を作り、動作を確認してから機能を足す。
- ALWAYS 通し版の後に追加・変更するコードは、行カバレッジ 80% 以上を満たし、CI でテストを実行してからマージする。

## Forbidden

- NEVER 本番へ、手動承認なしでデプロイしない。
