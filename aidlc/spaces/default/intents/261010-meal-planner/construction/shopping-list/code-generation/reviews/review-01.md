## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-12T06:22:28Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Minor | src/domain/shopping/index.ts > openShoppingList / retryPendingUnpicks | GET /api/shopping-list は、リストの作成と「選んだもの」の外し直しという書き込みを伴う。GET は CSRF 検査の対象外なので、他サイトからのページ遷移で書き込みが起きうる。影響は、空のリストが作られることと、完了済みリストの外し残しが進むことに限られる。 | 影響が小さいことを確認のうえ、許容するならコードコメントに残す。厳密にするなら、外し直しと作成を POST（例：/api/shopping-list/open）に分ける。 | New |
| R-02 | Minor | src/domain/shopping/index.ts > completeShoppingList（syncPicked と完了の取引の間） | 「同期」と「完了」が別の取引。間に別の人が「選んだもの」を変えても、完了の取引は行ロックの下で最新の行から外す対象を決めるので、外し漏れはない。ただし、同期後に追加された料理は行にも外す対象にもならず、リスト外のまま「選んだもの」に残る。業務としては妥当（買っていない）だが、利用者には見えない。 | 仕様どおりであることをテストか BR20.13 の注記で明記する。対応は不要。 | New |
| R-03 | Minor | src/domain/shopping/index.ts > performUnpick | 外してよいかの判定で、DB 側の pickedAt と、アプリ側の deps.now()（完了時刻）を比べている。サーバーと DB の時計がずれると、完了前に選んだ料理を外し損ねるか、完了直後に選び直した料理を誤って外す。 | 完了時刻を DB の now() で付けるか、時計のずれを許す幅を設ける。または、現状の前提（同じ時計）を設計に残す。 | New |
| R-04 | Minor | db/migrations/003_shopping.sql > shopping_items.amount_text / src/domain/shopping/compose.ts | 合算した数の分量の表示用文字列を amount_text（30 文字まで）に入れている。極端に大きい数を足し合わせると 30 文字を超え、挿入が制約違反になり同期全体が失敗する（stale 表示になる）。通常の入力では起きない。 | 合算結果の桁数に上限を置くか、数の行の amount_text を表示のたびに amount_number から作る。 | New |
| R-05 | Minor | db/migrations/003_shopping.sql > shopping_items.household_id | items.household_id と lists.household_id の一致は DB で保証されていない（コードは両方を絞り込んでいるため現状は安全）。 | 複合外部キー（list_id, household_id）で一致を強制すると、将来の取りこぼしに強くなる。 | New |
| R-06 | Minor | src/domain/shopping/amount.ts > parseAmount | 1/3 を 3 つ足すと 0.999999 になる（小数第 6 位への丸め）。画面は小数第 2 位に丸めるので「1」と見えるが、保存値は 1 ではない。浮動小数の誤差は出ない。 | 仕様（小数第 6 位まで）の範囲内。必要なら注記のみ。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| テスト（利用者報告） | 全 608 件成功 | 自分では再実行していない。報告を前提とした。 |
| 目視確認 | 003_shopping.sql、repo、domain、routes、router の CSRF と認証 | householdId の絞り込み・一意制約・取引は確認できた。UI（src/ui/shopping、src/app/shopping）は一覧のみで、中身は読んでいない。 |

### Summary

確認した範囲では Blocker／Major はない。householdId は入力から取らず、認証済みの文脈の値だけで全クエリを絞っている。作成中リストの一意性は部分一意索引と ON CONFLICT で、同期・完了は行ロック付きの取引で守られ、チェックは active の行だけを 1 文で更新する。分量は BigInt で正確に足している。「買い物おわり」の外し残しは完了と同じ保存で記録し、次に開くときにやり直す設計で、冪等。指摘はすべて Minor。
