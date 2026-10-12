## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-12T02:33:59Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | src/api/routes/cooklog.ts > `ctx()` と src/domain/cooklog/index.ts > `ensureCookLogHandlers` | 「グループ削除で記録を消す」受け口（household.deleted）が、作った記録の API が初めて呼ばれたときにだけ登録される。サーバー起動後に記録の API より先に「最後の 1 人が退会」が起きると、受け手がいないまま配信され、src/domain/admin/events.ts の `publishRecorded` が「配達済み」にしてしまう。再配信の対象にもならず、削除されたグループの記録（注意点メモを含む）が DB に残り続ける。テストは `ensureCookLogHandlers(deps)` を手で呼んでおり、この経路は検証されていない | 受け口の登録を、料理の初期データ登録（`registerSeedHandler`）と同じく依存の組み立て時（`createDeps` など）か、入口 `handle` の先頭で全リクエストに対して行う。あわせて、記録の API を一度も呼ばずに `leaveByAccount` で最後の 1 人が抜けたとき、cook_records が消えることを確かめるテストを足す | New |
| R-02 | Minor | src/domain/cooklog/index.ts > `fieldsSchema.cautionMemo` | メモの上限を zod の `max(1000)`（UTF-16 の単位数）で判定しているが、DB の制約は `char_length`（文字数）。絵文字など 2 単位の文字を含むメモは、1000 文字以内でも 400 になる（BR40.3 は「1000 文字まで」） | `[...value].length <= 1000` で数える | New |
| R-03 | Minor | src/domain/suggestion.ts > `setImpressionJudge` と src/domain/cooklog/index.ts 末尾 | 「もう作りたくない」の並べ替えは、cooklog モジュールが import されたときの副作用（モジュールの大域変数への代入）で有効になる。現状は router が cooklog を import するため動くが、候補の提案だけを別の入口から読むと、気づかないまま並べ替えが無効になる。U1 の既存挙動は壊れない（未設定なら従来どおり。乱数の呼び出しも 1 回のまま）ので、安全側ではある | 組み立て時（`createDeps` など）に明示的に差し込むか、router に「並べ替えが有効であること」を確かめるテストを 1 件足す | New |
| R-04 | Minor | src/repo/cooklog/index.ts > `insertRecord` | 同じ INSERT を 2 回書いた「取り直し」がある。動作は正しい（一意制約と `on conflict do nothing` で同時追加も 1 件に保たれる）が、重複していて読みにくい | 内部関数にまとめる（任意） | New |
| R-05 | Minor | src/domain/cooklog/index.ts > `editRecord` の `duplicateError(other?.recordId ?? recordId)` | 重複の相手が見つからなかったとき、自分自身の recordId を「すでにある記録」として返す。画面は「すでにある記録を編集する」から自分自身を開くことになる（まれな競合時のみ） | 相手が消えていた場合は、もう一度更新を試すか、重複ではなく再試行を促すエラーにする | New |
| R-06 | Minor | aidlc/spaces/default/intents/261010-meal-planner/construction/cook-log/code-generation/code-summary.md > 検証 | 行カバレッジ 80% 以上（通し版のあとに追加するコードの必須事項）が未計測。ブラウザでの見た目も未確認と記載されている | Build and Test で必ずカバレッジを測り、下限を満たすことを確かめる | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 単体テスト（レビュー依頼に記載） | 297 件成功（U5 は 75 件、既存 222 件） | 既存の U1 の挙動は緑のまま。本レビューでは再実行していない（コードの読み取りのみ） |

### Summary

重点 5 項目のうち 4 項目は問題なし。他のグループの拒否は、記録・料理名・メンバー名のすべての SQL が `household_id` で絞られ、`householdId` は入力から受け取っていない（router で認証と CSRF を済ませてから渡される）。日本時間の今日の判定と、未来日・同日重複（一意制約と競合時の取り直し）、料理の論理削除後も記録を残す扱い、U1 の候補選びを壊さない拡張点も、読んだ範囲で仕様（BR40.x）どおり。気になるのは 1 点で、household.deleted の受け口が遅延登録のため、グループ削除で記録が消えないことがある（Major）。Critical はなく、Major は 2 件以下のため READY とするが、承認の前にこの 1 件は直すことを勧める。
