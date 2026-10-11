## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T07:39:12Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | src/domain/admin/index.ts > redeliverEvents / src/domain/admin/events.ts > redeliverPendingEvents / src/domain/admin/handlers.ts > ensureAdminHandlers | 配り直しの関数 `redeliverEvents` はどこからも呼ばれていない（src 内の呼び出しは定義のみ）。また `account.deleted` の受け口は `deleteAccount` が呼ばれたプロセスでだけ登録される。そのため、アカウント削除の直後に受け口が失敗した場合、またはプロセスが再起動した場合、`account.deleted` は未配達のまま残る。結果として、削除済みアカウントのメンバーが退会にならず、グループに有効なメンバーとして残る。最後の 1 人だった場合はグループも削除されない（BR50.21、BR50.23 を満たさない）。 | アプリの起動時と一定間隔で `redeliverEvents(deps)` を呼ぶ処理を `src/server/deps.ts` などの起動経路に足す。あわせて、再起動後の配り直しで受け口が登録されていることを確かめるテストを足す。 | New |
| R-02 | Major | src/api/routes/admin.ts > GET /api/dev/mail-outbox / src/domain/admin/mail.ts > devMailOutboxEnabled | 開発用の送信箱の取得は認証なしで、メールアドレスを渡すだけで再設定リンクを返す。有効かどうかは `NODE_ENV !== 'production'`（`requireAppOrigin` の否定）で決まるため、NODE_ENV が未設定、または「検証環境」で production 以外の設定のままデプロイされると、メールアドレスを知っているだけの第三者がパスワード再設定でアカウントを乗っ取れる。仕様（BR50.25）の範囲内ではあるが、有効にする条件が暗黙で広い。 | 送信箱の機能を、専用の環境変数（例: `DEV_MAIL_OUTBOX=1`）で明示的に有効にしたときだけ使えるようにし、既定は無効にする。検証環境の設定では無効にすることを README に書く。 | New |
| R-03 | Minor | src/domain/admin/invitation.ts > joinHousehold | `findAccountById` をトランザクションの外で行い、トランザクション内ではアカウントの行をロックしていない。アカウント削除（`deleteAccount`）は退会と直列にならず、削除が参加の直前に確定した場合、削除済みアカウントに有効な Member が作られうる（`account.deleted` は参加より前に処理済みで、退会されない）。窓は狭いが、「削除と退会の直列化」の観点で穴がある。 | トランザクション内で `accounts` の行を `for update`（`deleted_at is null` つき）で確かめてから Member を追加する。`markAccountDeleted` も同じ行を更新するので直列になる。 | New |
| R-04 | Minor | src/domain/auth.ts > login / src/domain/admin/account.ts > deleteAccount | ロックの確認と、パスワード検証、失敗の記録が別々の文になっている。ロック前に並列で届いた複数のリクエストは、すべてロックの確認を通り、5 回を超えて推測できる（1 回の記録自体は 1 文で数え落としはしない）。並列数の分だけの超過で、深刻ではない。 | 許容するなら、その旨を code-summary の注意に書く。厳密にするなら、検証の前にアカウントの行をロックするか、失敗の記録の結果（ロックされたか）を見て応答を決める。 | New |
| R-05 | Minor | src/domain/admin/password-reset.ts > requestPasswordReset | 登録済みのアドレスでは DB のトランザクションとメール書き込みが走り、未登録では早く返るため、応答時間の差で登録の有無を推測できる（応答の文言は同じ）。また、他人のアドレスで 1 時間に 3 回発行すると、本人の再設定が上限に達して止められる（BR50.2 の暫定の副作用）。 | 時間差は許容するか、メール送信を非同期にして差を小さくする。上限の副作用は、承認時に受け入れるかを確認する。 | New |
| R-06 | Minor | src/domain/auth.ts > login | ロック中は、登録済みのアドレスだけ別の文言（約 15 分）を返すため、5 回失敗させるとアドレスの登録有無が分かる。仕様（BR50.6）どおりの動きで、仕様自体のトレードオフ。 | 仕様どおりなら対応は不要。リスクとして残る旨を Build and Test の注意に残す。 | New |
| R-07 | Minor | src/domain/admin/membership.ts > leaveByAccount | `lockLiveHousehold` の戻り値を見ていない。削除済みのグループで呼ばれた場合も先に進む（実際は、削除済みのグループに有効なメンバーはいないので到達しにくい）。 | 戻り値が false のときは、`left: false` で終えるか、明示的に扱う。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 提出されたテスト（typecheck / lint / unit 222 件） | 成功と報告（このレビューでは再実行していない） | 振る舞いの一部は確認済みと扱う。上記の 2 件の Major は、テストにない配線と設定の問題 |
| 重点項目の読み取り確認 | 下記のとおり | コードを読んで確認した |

確認できた点（問題なし）:
- 招待の同時使用: `lockLiveHousehold`（グループの行の `for update`）で参加・退会・削除・発行を直列にし、`markInvitationUsed` が `used_at is null and expires_at > now` の条件つき更新で成功を 1 回に限る。Member 追加に失敗すると使用済みも取り消される。`members_active_account_uq` が 1 人 1 グループを DB で守る。
- 期限: 参加は期限内のみ。期限切れは 410（`InvitationExpiredError`）。使用済みと期限切れの判定順も妥当。
- 他グループの拒否: 参加先・発行先は、リンクの `Invitation.householdId` とログイン状態だけで決まり、入力から `householdId` を受けない。発行・概要は `auth: household`、参加・退会・削除は `auth: user`。
- ログイン失敗のロック: 失敗の加算が 1 文でアトミック。ロック中は正しくても拒否し、回数・期限を変えない。期限切れで数え直し、成功と再設定の成功で解除。未登録・削除済みは数えない。
- トークン: 256 ビットの乱数で、保存は種類つき SHA-256 の変換値のみ（招待を再設定に流用できない）。再設定の確定は、使用済み化・パスワード更新・全セッション削除が 1 トランザクション。パスワード不備ではリンクを消費しない。
- ログ・レスポンス: ロガーは `password` / `token` / `email` などを伏せ字にし、エラーは名前だけを出す。リクエストログは URL を出さない。招待の値は発行の応答で 1 度だけ返し、`/join` は `referrer: no-referrer`。
- CSRF・認可: 入口で、GET/HEAD/OPTIONS 以外のすべてが Origin と合言葉の両方を要求される（`auth: none` の再設定・プレビューも含む）。
- 削除と退会: 退会は `lockLiveHousehold` で直列化され、冪等。最後の 1 人の確認が必要。アカウント削除は、メール・変換値・表示名を空にし、DB 制約でも守る。

### Summary

重点項目（招待の同時使用、期限、他グループの拒否、ロック、秘密のログ漏れ、CSRF/認可）は実装とDB制約で概ね堅い。Major は 2 件（イベント再配達が未配線、開発用送信箱の有効条件が広い）で、READY の基準（Major 2 件以下）の範囲内だが、どちらも本番前に直す価値がある。
