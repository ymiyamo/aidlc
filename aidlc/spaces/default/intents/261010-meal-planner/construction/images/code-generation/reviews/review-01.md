## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-12T05:38:09Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | src/app/dishes/new/page.tsx > onSubmit | 新しい料理の保存画面で画像を選んでも、画像は登録されません。DishForm は onSubmit が `{ dishId }` を返したときだけ画像を登録しますが、この画面の onSubmit は何も返さずに `/dishes` へ移動します。利用者には何も表示されず、選んだ画像が黙って捨てられます（BR60.5 の「先に料理を保存し、その dishId で画像を登録する」が実際の画面ではつながっていません）。DishForm 単体のテストは通っていても、この画面を通した確認がありません | `POST /api/dishes` の応答から dishId を受け取って onSubmit が `{ dishId }` を返し、画像の登録が終わってから移動するようにする。画像が拒否されたときは、料理は保存済みであることを示して編集画面へ案内する。この画面を通すテストを足す | New |
| R-02 | Major | src/api/router.ts > dishes.delete と src/domain/images/index.ts > deleteImagesForDish | 料理を削除しても画像が消えません。`deleteImagesForDish` はどこからも呼ばれておらず、登録画像と生成画像の実体と記録が残ります（BR60.12）。料理は論理削除で getDish が見えなくするため、他の人には見えませんが、実体はディスクに残り続けます。また `household.deleted` の受け口は画像の API が最初に呼ばれたときにだけ登録されるため、起動後に画像の API を使う前にグループが削除されると、画像が消えません | 料理の削除の流れ（removeDish の後）から `deleteImagesForDish` を呼ぶ。`household.deleted` の受け口は、cooklog と同様にサーバー起動時にまとめて登録する。料理削除で画像の実体が消えることを確かめるテストを足す | New |
| R-03 | Minor | src/api/router.ts > readBody | 本文を全部読み込んでから JSON として解析するため、5MB の上限を確かめる前に、巨大な本文でメモリを使わせられます。認証後なので影響は所属メンバーに限られます。`decodedLength` の「復元前に断る」の利点が、この手前で失われています | 画像の PUT だけ、`content-length` が約 7MB（base64 の増え分を含む）を超えたら 413 で読まずに断る | New |
| R-04 | Minor | src/domain/images/index.ts > registerImage と src/repo/images/index.ts > upsertRegistered | 同じ料理への登録が同時に来ると、`select ... for update` は行がまだ無い場合は何もロックしないため、片方の古い保管の名前が取り違えられ、実体が 1 つ孤児として残ることがあります。有効な行は 1 件のままで、一意制約は守られます | 孤児が残りうることを許容するなら、その旨を code-summary に記す。厳密にするなら、`on conflict ... returning` と古い値の取得を 1 文にまとめる | New |
| R-05 | Minor | src/domain/images/index.ts > ensureGeneration と runGeneration | 期限切れで作り直した pending の裏では、古い生成処理がまだ動いていることがあり、同じ行に対して 2 つの処理が回数を数え合います。どちらかが ready にするだけで、結果は壊れませんが、回数の上限に早く達することがあります | generatedImageId でなく、作り直しのたびに変わる世代の印（または requested_at）を markReady と bumpAttempt の条件に加える | New |
| R-06 | Minor | src/ui/DishForm.tsx > 編集時の画像登録 | 編集では、料理の更新より先に画像を置き換えます。そのあと料理の更新が検証エラーや重複で失敗すると、画像だけが変わった状態になります | 料理の更新が成功してから画像を登録する（新規の流れと同じ順にそろえる） | New |
| R-07 | Minor | src/domain/images/index.ts > decodedLength | base64 に改行や空白が入っていると実際より大きく数えるため、5MB 近い画像を誤って 413 にすることがあります。逆方向（上限超過を通す）にはなりません | 空白を除いてから数えるか、先頭バイトの判定後に実際の大きさだけで判定する | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 指定された検証ツール | 実行せず | このレビューの依頼に検証ツールの指定がなく、実行していません。テスト 367 件成功は依頼文の申告で、私は再実行していません |

### 重点観点の確認結果

- 先頭バイトの判定と 5MB 上限：JPEG・PNG・GIF・WebP は先頭バイトで判定し、拡張子や申告された種類は使っていません。5MB ちょうどは通り、超過は 413、画像でないものは 415、空は 415 です（BR60.1、BR60.2）。DB 側にも `byte_size` と `content_type` の制約があります。
- パストラバーサル：保管の名前は `registered|generated/` と 48 桁の 16 進だけを受け付け、名前はサーバーが乱数から作ります。素材の seedKey も `[a-z0-9_-]` に限られ、ドットやスラッシュは通りません。問題なし。
- 取得時の認証とグループ確認：画像の実体の取得は `auth: 'household'` で、householdId はログイン状態から決まり、すべての問い合わせが householdId で絞られます。他グループの料理や形の違う ID は「見つからない」で、区別がつきません。`?v=` は無視されます。問題なし。
- 応答のヘッダー：Content-Type は判定した形式から作り、`x-content-type-options: nosniff` と `cache-control: private, no-store` が付きます。SVG などの能動的な形式は受け付けません。問題なし。
- pending の期限：10 分の期限、期限切れの再要求、`failed` は明示の要求のときだけ再要求、という BR60.7 の流れを確認しました。
- 既存の DishCard と DishForm：DishCard は読み込み中・取得失敗のとき従来と同じ頭文字の枠を出し、DishForm の変更は追加のみで、既存の 297 件が成功しています。ただし新規保存の画像登録は上の Major のとおり、実際の画面につながっていません。

### Summary

画像の判定、5MB 上限、パス、グループ確認、ヘッダーの安全面は仕様どおりで、危険な欠陥は見つかりませんでした。一方、新規保存画面で選んだ画像が黙って捨てられる点と、料理削除で画像が消えない点の 2 件の Major があります。基準（Critical なし、Major 2 件以下）では READY ですが、承認の前に 2 件の Major を直すことを推奨します。
