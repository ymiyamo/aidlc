## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-12T06:04:08Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Minor | src/domain/taste/index.ts > addDislike の nameSchema、src/domain/taste/filter.ts > tag | 食材名や気分のタグに NUL 文字（u0000、URL なら %00）を入れると、検証を通ったあと PostgreSQL が「不正なバイト列」で拒否し、入力エラー（400）ではなく 500 になる。データは壊れず、SQL はパラメーター渡しなので注入にもならないが、利用者への案内が「エラーが発生しました」になる | 食材名とタグの検証に、制御文字（少なくとも NUL）を拒否する条件を足し、入力エラーにする | New |
| R-02 | Minor | src/domain/taste/index.ts > ensureTasteHandlers（呼び出しは routes/taste.ts の ctx と tasteExclusion） | 出来事の受け口が、好き嫌い関連の最初の要求が来たときに初めて登録される。プロセスの起動後にその要求より先にメンバーが抜けると、household.member-left を受け損ね、登録行が残る。除外一覧は現在のメンバー（left_at が空）の登録だけで作られる（listExcludedNames）ので、除外が過剰になる実害はない。household.deleted も同様で、削除済みグループには誰も入れない。cooklog、images の受け口と同じ作りで、設計（BR10.21、BR10.22 の違反時の記述）どおり | 対応は必須ではない。残った行を確実に消したいなら、起動時に一度だけ受け口を登録する場所へ移す。方針を変えないなら、現状を設計の許容範囲として記録しておく | New |
| R-03 | Minor | src/repo/dishes.ts > MATCH_WHERE の除外条件 | 除外は `position(x.n in i.ingredient_name) > 0` の部分一致で、設計（BR10.7）どおり。ただし 1 文字の食材名（例：「卵」）は材料名「卵白」「うずら卵」などにも一致し、候補が想定より多く外れる。これは設計が選んだ挙動（Q1 A）であり、不具合ではない | 画面の嫌いな食材の入力欄に、部分一致で外れることを示す短い説明があるか確認する（なければ追記）。コードの変更は不要 | New |
| R-04 | Minor | src/domain/suggestion.ts > noneReason | 絞り込みを指定していない状態で対象が 0 件のとき、一律で all_excluded を返す。いまは除外以外に 0 件になる経路がないので正しいが、将来ほかの絞り込み要因が増えると案内が誤る | 注意書きのコメントを足す程度でよい。対応は任意 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 自動テスト（依頼文の記載） | 全 518 件成功 | 実行はしていない。依頼文の報告を前提にした。本レビューは対象コードと設計（BR10.x）を読み合わせた結果である |

### Summary

重点の観点は、いずれも設計どおりに実装されていて、Critical と Major の指摘はない。確認した内容は次のとおり。

- **グループでの絞り込み**: src/repo/taste/index.ts の全問い合わせに household_id の条件がある。登録・削除は本人（memberId）と householdId の両方で絞り、他の人・他グループの ID は notFound になる。memberId と householdId は画面の入力ではなくセッションから決まる。lockActiveMember は退会済みや他グループのメンバーを拒否する。
- **除外の正確さ**: 除外一覧は members と結合し、left_at が空の現在のメンバーだけから作る（BR10.6）。照合は position() による大文字小文字・全角半角を区別する部分一致で、LIKE のワイルドカード問題はない。材料が 0 行の料理は not exists により外れない（BR10.9）。空文字の食材名は repo 側でも取り除いている。「選んだもの」は除外しない（BR10.8）。
- **SQL の安全性**: 値はすべてパラメーターで、文字列連結は固定の MATCH_WHERE だけ。配列は ::text[] にキャストしている。
- **既存機能への影響**: U1 の候補の取得は listMatchingDishes に置き換わったが、listCandidateIds は選んだものを引く形で残っている。U5 の「もう作りたくない」の並べ替え（preferredPool）は、除外・絞り込み後の ids にそのまま適用され、壊れていない。除外の取得に失敗した場合は握りつぶさず上に返す（BR10.25）。
- **CSRF と認可**: 新しい経路はすべて入口の router に登録され、POST と DELETE は入口の CSRF 検査を通る。auth は 'household' で、GET も含めて認証とグループ所属が必須。URL の検索語は encodeURIComponent で変換され、外部リンクには rel="noopener noreferrer" が付いている。
- **移行**: 002_taste.sql は追加のみで、(member_id, ingredient_name) の一意制約を持つ。退会とグループ削除は論理削除なので、外部キーの衝突は起きない。

Minor の 4 件は承認を止めるものではない。特に 1 件目（NUL 文字で 500）は、入力検証を直す小さな修正で足りる。
