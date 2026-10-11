## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-11T06:19:36Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/images/functional-design/functional-spec.md > WF1 手順 1〜2、rules.md > BR60.5 | 「新しい料理を保存する画面」で画像を選ぶ流れが決まっていない。AC1.5.2 は「保存または編集の画面」で登録するとしているが、WF1 は手順 2 で既存の dishId を前提にしている。新規保存の画面では dishId がまだない。実装者は「先に料理を保存してから画像を送る（2 段階）」のか「画像を一緒に送る」のかを推測するしかない。保存は成功し画像だけ失敗した場合の扱い（BR60.1、BR60.2 の入力エラー後の画面）も未定義。 | WF1 に新規保存の場合を書く。例：料理の保存が成功してから、その dishId で画像を登録する。画像が入力エラーのときも料理は保存済みとし、編集画面で理由を示して再登録できる、と明記する。 | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/construction/images/functional-design/functional-spec.md > ST1、rules.md > BR60.7、BR60.8、entities.md > GeneratedImage | GeneratedImage が pending のまま残ると抜け出せない。裏の処理が途中で止まる（再起動、異常終了）と、pending の記録だけが残る。BR60.7 は同じ dishId の記録があれば再要求しない（冪等）ので、新しい要求では作り直されず、WF3 は pending を返し続ける。画面は「作成中」を永遠に取り直す。ST1 に pending から出る道は、生成の結果と上限だけである。 | pending に期限を決める（requestedAt から一定時間たった pending は、再要求できる、または failed とみなす）。ST1 と BR60.7 にその遷移を足す。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 目視の照合（traceability.json と stories.md） | AC1.5.1〜AC1.5.4、AC9.1.7、AC9.1.8 の 6 件すべてが BR に対応。BR60.11〜BR60.14 は reverse で N/A と理由つき | 網羅は取れている |
| 目視の照合（U1 の entities.md / rules.md） | U1 の Dish は画像を持たず、seedKey と source を持つ。U6 は dishId と seedKey だけで参照 | U1 の設計・ADR-005/008/009 と矛盾しない |
| 技術非依存 | 保管は「ディスク／オブジェクト保管」の抽象。413/415 は契約の参照として補足にだけ記載 | 問題なし |

### Summary

担当 AC の網羅と U1 との整合は取れている。ただし、新規保存の画面での登録の流れと、pending で止まった生成の回復が未定義で、実装者が推測する箇所になる。軽微（メモ）：(1) 失敗（failed）の GeneratedImage は削除まで再試行されず、サービス決定後に作り直せない。(2) 保存・編集直後の要求は、記録が既にあると何もしないので、料理名を編集しても画像は更新されない（Q1 の意図とずれる）。(3) 質問にない判断（誰でも登録・外せる、altText、削除の連動）は rules.md に出所を示しており許容範囲。(4) OQ1〜OQ2（U1 への問い合わせ窓口、画像の実体を取る窓口）は Code Generation で確認する扱いで、通し版では事前確認を推奨。
