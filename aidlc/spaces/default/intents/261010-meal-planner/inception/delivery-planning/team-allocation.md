# 担当の割り当て（Team Allocation）

どのボルト（作業のまとまり）を、誰が進めるかを書く。このファイルだけを開いても分かるよう、用語を先に説明する。

| 日本語 | 英語 | 意味 |
|---|---|---|
| ボルト | Bolt | 1 回の作業のまとまり。動くものが残って終わる（内容は `bolt-plan.md`） |
| モブ | Mob | 複数の人（または役割）が、1 つの画面を囲んで一緒に作る進め方 |
| プログラムボード | Program Board | 複数のチームが、どのボルトを誰が担当し、どの順で進めるかを 1 枚にまとめたもの |

## Sources

- [Q10] `delivery-planning-questions.md` の回答：A（この 1 つのセッションで、AI が進める）
- [Q4]、[Q8] 同時に作れるところは同時に作る（B）

## Assumptions & Open Questions

- [assumption] チームの編成の段階（Team Formation）は、このスコープ（classic）では実行していない。そのため、すべてのボルトを、開発の担当の AI（aidlc-developer-agent）が進める。
- [assumption] チームは 1 つだけ（人は、確認と承認をする）なので、プログラムボードは不要。
- OQ1 同時に作るボルトの数の上限は、実装のときに決める（AI の処理の数と、人の確認の負担を見て決める）。

## 割り当て

| ボルト | ユニット | 担当 | 人の役割 |
|---|---|---|---|
| B1 | U1 最小の通し版 | AI（aidlc-developer-agent） | 最小の通し版の確認と、別の承認 |
| B2 | U2 好き嫌いと絞り込み | AI（aidlc-developer-agent） | 確認と承認 |
| B3 | U5 作った記録 | AI（aidlc-developer-agent） | 確認と承認 |
| B4 | U7 グループとアカウントの管理 | AI（aidlc-developer-agent） | 確認と承認 |
| B5 | U3 買い物リスト | AI（aidlc-developer-agent） | 確認と承認 |
| B6 | U4 献立 | AI（aidlc-developer-agent） | 確認と承認 |
| B7 | U6 画像（最初の版の外） | AI（aidlc-developer-agent） | 確認と承認 |

## 進め方

- 作る段階は、1 つのセッションで進める（チームごとの担当はしない。Q10 A）。
- 設定は「段階ごとに進める」（stage-major）と「ユニットを並行して作る」（swarm）。最小の通し版（U1）だけは、先に全工程を終えて、確認と承認を受けてから、ほかのユニットを並行して進める。
- 並行して作る間は、AI が複数の作業を同時に進める。人の確認は、ユニットごとに 1 回ずつ、まとめて受ける。
