## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T04:59:00Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | infra/lib/meal-planner-stack.ts > appFn の environment、src/api/csrf.ts > expectedOrigin | AWS 上では、状態を変える操作（登録・ログイン・保存など）がすべて拒否される恐れがある。Origin の照合の基準は、`APP_ORIGIN` が未設定だとリクエストの URL になる。しかし AWS では配信網（CloudFront）が `Host` を除いて転送するので、アプリが見る URL は API の入口のホスト名になり、画面が送る Origin（配信網のドメイン）と一致しない。infra の環境変数に `APP_ORIGIN` が無く、TODO の一覧や code-summary の「未完の点」にも載っていない。また、本番で `APP_ORIGIN` が未設定でも、リクエストの Host を信用して動いてしまう（弱い側に倒れる） | infra に `APP_ORIGIN`（配信網のドメイン）を渡す TODO を足して code-summary の未完の点に載せる。あわせて、`NODE_ENV=production` で `APP_ORIGIN` が未設定なら、起動時に失敗するか、状態を変える操作を拒否する形にする | New |
| R-02 | Major | src/repo/dishes.ts > insertDish、updateDish、replaceIngredients / src/domain/dish.ts > createDish、editDish | 料理本体と材料の行（DishIngredient は Dish の一部、entities.md）が、別々の問い合わせで書かれ、1 つの処理（トランザクション）になっていない。更新は「材料を全部消して入れ直す」ので、途中で失敗すると材料が消えたままになる。同じ料理を 2 人が同時に編集すると、`(dish_id, position)` の主キー違反で 500 になりうる。初期データ（seed.ts）とグループ作成は処理にまとめてあるのに、ここだけ抜けている | 料理の作成・更新を `deps.db.transaction` の中で行い、材料の入れ直しまで含めて一括にする。更新は対象の行を先にロックする（`select ... for update`、または更新の `update` を先に行う順序の維持）。同時編集のテストを 1 件足す | New |
| R-03 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/skeleton/code-generation/traceability.json > coverage の NFR7.10 | NFR7.10（検証環境へマージ時に自動デプロイ、本番は手動承認を経る）が `OK`（対象 `.github/workflows/ci.yml`）になっている。しかし ci.yml には「デプロイは書かない」と明記されており、自動デプロイも本番の承認の流れも実装されていない。この `OK` は実態と合わない。security-design.md のとおり、この項目は NFR3.4 の公開制限の確認とも結び付いている | NFR7.10 を `Deferred` に直し、理由（デプロイの流れは AWS に作る前の承認までに追加する）を書く。code-summary の未完の点にも 1 行足す | New |
| R-04 | Minor | src/api/http.ts > parseCookies | 壊れた Cookie（`%` で始まる不正な値）で `decodeURIComponent` が例外を出し、認証前に 500 になる | try/catch で、その Cookie を無視する | New |
| R-05 | Minor | db/migrations/001_init.sql > picked_items、dishes | `picked_items.dish_id` は dishes の主キーだけを参照し、household_id の一致を表が守らない（アプリ側の `pickDish` が getDish で確認している）。最後の守りは薄い | U1 では許容。U2 以降で複合外部キー（household_id, dish_id）を検討する | New |
| R-06 | Minor | src/repo/picked.ts > listPicked | 行ごとに `getDish` を呼ぶ（N+1）。200 件規模では問題ない | 後で結合に直す | New |
| R-07 | Minor | docker-compose.yml、src/repo/sessions.ts | DB のポートが全インターフェースに公開され、パスワードは固定の `mealplanner`。期限切れのログイン状態の行は消す処理がない | ポートを `127.0.0.1:5432:5432` に絞る。期限切れの掃除は U7 で扱う | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| テスト 117 件、lint、typecheck、build | オーケストレーターが実行して成功を確認済み（再実行していない） | 実装の整合の基礎は取れている。ただし上の 3 件の Major は、テストでは見つからない種類（デプロイ環境の設定、同時実行、記録の正確さ） |

### 観点ごとの確認結果

- **(1) グループ範囲・CSRF・認証・Cookie：** `src/repo/dishes.ts`、`picked.ts` のすべての問い合わせが `household_id` を引数に取り、他のグループの ID は 404 になる。入口は `handle` の 1 か所で、`householdId` は Cookie → ログイン状態 → Member から決まり、画面の入力から読まない。ログイン状態は変換値（SHA-256）だけ保存。Cookie は HttpOnly、SameSite=Lax、Secure は設定で決まる。登録・ログイン・ログアウトも CSRF の対象になっている。Origin と合言葉の両方が必要で、設計と一致。懸念は上の 1 件目（本番の基準の決め方）。
- **(2) 一意制約・同時実行・初期データ・BR4.x：** メールの小文字一意、有効な Member の部分一意、`(household_id, seed_key)` の一意（削除済みも含む）、PickedItem の `(household_id, dish_id)` の一意がすべて DB にあり、`on conflict do nothing` で冪等。初期データは `ensureSeeds` を何度呼んでも同じ。候補は「削除済み・選んだもの・見た料理」を除いてランダムで、0 件のとき `empty`/`done` を区別し、BR4.1〜BR4.5、BR4.7、BR4.11 と一致している。同時実行の穴は上の 2 件目。
- **(3) ログ・秘密：** リクエストのログは route 名・状態・時間・requestId だけで、ID や URL を含まない。ロガーは項目名で自動の伏せ字をし、`Error` は名前だけ出す。コードに秘密の値はない（`TODO-change-me-before-deploy` は仮の値で、`cdk.out` は gitignore 済み）。
- **(4) traceability：** Deferred の理由（U2/U4/U6/U7 の担当、AWS に作成後の測定、infra の TODO）は正直。`OK` の過大は NFR7.10 のみ（上の 3 件目）。NFR3.4、3.12、3.13、4.14、4.15 を Deferred にして「AWS に作る前の承認までに完成させる」と書いているのは妥当。
- **(5) infra の約束との整合：** 「実際には作らない」「骨組み」「TODO を明記」という約束と実装は一致している（アプリ本体は 503 を返す仮のコード）。欠けているのは `APP_ORIGIN` の TODO（1 件目）と、デプロイの流れ（3 件目）。

### Summary

認可・一意制約・冪等・ログの伏せ字は設計どおりで、ローカルで触る分には大きな問題はない。ただし、(1) AWS 上では CSRF の基準がずれて書き込みが全部拒否される恐れがあること、(2) 料理と材料の書き込みが 1 つの処理になっていないこと、(3) NFR7.10 の `OK` が実態と合わないことの 3 件の Major を、直してから承認してほしい。いずれも小さな修正で済む。
