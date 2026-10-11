## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/domain-design/components.md > Household の dependents、OQ3 | グループ削除（最後の 1 人が抜けたとき、FR7.6）では、householdId を持つ全データ（Dish、CookRecord、PickedItem、MealPlan、ShoppingList、GeneratedImage、DislikedIngredient）を消す必要がある。しかし Household の dependents は Taste と Dish だけで、CookLog、Suggestion、MealPlan、ShoppingList、ImageGen は出来事の受け手として宣言されていない。OQ3 で Contract Design に先送りされているが、依存の向きと循環の有無はこのステージで決めるべき内容で、カタログの依存は不完全である。 | Household の出す「グループが削除された」出来事の受け手を、全コンポーネントについて depends_on と dependents の両側に足す。足したあとも循環がないことを確かめる。 | New |
| R-02 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/domain-design/components.md > Dish の dependents、CookRecord、PickedItem、PlanDay、ShoppingItem、GeneratedImage | 項目（Dish）を削除したときの連鎖が、どこにも書かれていない。CookRecord、PickedItem、PlanDay、ShoppingItem（sourceDishId）、GeneratedImage が dishId を持つので、そのままでは宙に浮いた参照ができる（作った記録のカレンダー、献立、買い物リストが壊れる）。CookLog の「項目が存在するかを確かめる」は、追加時の確認だけで、削除には効かない。 | Dish 削除時の扱い（連鎖して消す、削除を断る、論理削除にする）を決め、受け手の依存と、削除の出来事（または確認の問い合わせ）を ADR に足す。 | New |
| R-03 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/domain-design/components.md > ImageGen、CookLog、Suggestion の depends_on と references | エンティティの参照に対して、依存が宣言されていない。GeneratedImage は Dish を指すが、ImageGen の depends_on は空である（画像を渡す戻りの向きもあり、実際は ImageGen から Dish への結び付きがある）。CookRecord と PickedItem は Member（Household が持つ）を指すが、CookLog と Suggestion は Household に依存していない。Dish.createdBy も Member を指すのに references にない。隠れた結合があり、矢印の図も実態より少ない。 | 参照の向きと依存を合わせる（依存を足すか、memberId/dishId を ID だけの値として扱うと明記する）。Dish.createdBy の参照を足す。ImageGen から Dish への結果の受け渡しが、コールバックなのか、Dish からの取得なのかを決めて、向きを揃える。 | New |
| R-04 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/domain-design/decisions.md > ADR-005 | 入口で 1 度だけ所属を確認する案は、NFR3.2（他グループに見せない）を、入口の実装 1 か所の正しさに預けている。入口は、カタログにコンポーネントとして現れず、誰が持つのか分からない。また、sync の呼び出し（CookLog → Dish、Suggestion → Dish、MealPlan → Dish）に他グループの dishId や memberId を渡されても、受け側が householdId で絞ることを前提にしているだけで、その仕組みは未定義である。出来事の経路（リクエスト外）には入口の確認がない。 | 入口の確認の持ち主（Account と Household を使う共通の仕組み）を明記する。コンポーネントの間の呼び出しでも householdId を必ず渡し、受け側で絞る決まりと、他グループの ID を渡した場合のテスト方針を ADR に足す。 | New |
| R-05 | Major | aidlc/spaces/default/intents/261010-meal-planner/inception/decisions.md を含む decisions.md > ADR-007 | 出来事で伝える案は、届かないときの影響が重い。FR7.4（抜けた人の嫌いな食材を外す）が遅れると、グループの除外一覧に抜けた人の好き嫌いが残る。FR12（初期データ 30 件）の出来事が失われると、新しいグループが空のままになる。アカウント削除は 2 段（Account → Household → Taste）で、途中の失敗が残る。「再送、後から整える」の要否が Contract Design に先送りされ、このステージの前提（整合性を、いつまでに保つか）が決まっていない。 | 各出来事について、「少なくとも 1 回届く」「受け側は同じ出来事を二度受けても結果が同じ」を前提として ADR に書く。または、FR7.4 と FR12 は同期の呼び出しで行うなど、失われては困る連鎖を区別する。 | New |
| R-06 | Minor | aidlc/spaces/default/intents/261010-meal-planner/inception/domain-design/components.md > Dish の external_dependencies | 「初期データのファイル」を object-store として外部の依存にしているが、実態はプログラムと別に持つデータファイル（設定に近い）で、置き場のサービスとは違う。 | 種類を実態に合わせるか、外部の依存から外し、振る舞いの説明に留める。 | New |
| R-07 | Minor | aidlc/spaces/default/intents/261010-meal-planner/inception/domain-design/components.md > OQ2、Member.displayName、CookRecord.memberId | FR7.5（アカウント削除後も、記録と項目は残し、名前は表示しない）で、Member を外したあとの memberId の参照先（Dish.createdBy、CookRecord.memberId、PickedItem.memberId）の扱いが OQ2 に先送りされている。参照先が消える構造のまま Functional Design に渡る。 | 外したメンバーの識別子を残すか（退会済みの印）、参照を外すかの方向だけでも、ここで決める。 | New |
| R-08 | Minor | aidlc/spaces/default/intents/261010-meal-planner/inception/domain-design/components.md > Suggestion の behaviour | 候補を作るたびに、Dish、Taste、CookLog の 3 つへ同期で問い合わせる構造である。初期の規模では問題ないが、性能の目標が書かれていないので、一括で聞く問い合わせの形（ADR-006 の「一括」）が、Contract Design の必須条件になることを明記したほうがよい。 | Contract Design への引き継ぎ事項として、一括の問い合わせを書き足す。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability | PASS（目視） | traceability.json に US1.1〜US9.1 の 38 件がすべてある。OK の対象は components.md の名前に解決できる。N/A は Won't の US4.2、US8.1〜US8.4 のみ（Must の漏れは見当たらない）。 |
| yaml カタログの整合 | PASS（目視） | 名前は一意、自己依存なし、depends_on と dependents は対称、循環なし、全エンティティに識別子と持ち主が 1 つある。references.entity の持ち主の宣言も一致する。ただし上の指摘のとおり、参照と依存の食い違いはある。 |
| required-sections | PASS（目視） | Sources と Assumptions & Open Questions の見出しがある。 |

### Summary

カタログの形式（対称性、循環なし、ID と持ち主）は整っているが、グループ削除と項目削除の連鎖、エンティティの参照に対する依存の不足、ADR-005 と ADR-007 の前提の弱さが、実装時の手戻りになる。Major が 5 件あるため NOT-READY とした。承認時には、特に ADR-005 と ADR-007 の前提を確認してほしい。
