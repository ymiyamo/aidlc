# Code Generation Plan Approval

AI-DLC built this plan without asking because plan approval is off for this
piece of work. This file is the record and asks nothing; to look at a plan
before it is built, ask in chat.

## Plan Approval

Built without asking: plan approval is off for this piece of work (set by you).

- Builds: 1 週間（7 日分）の献立の提案（同じ料理は 1 回まで、同じ食材の種類が 3 日続かない、除外と並び替えは U2・U5 の結果をそのまま使う）、日ごと・週全体のやり直し、足りない日の空欄（理由と保存の案内つき）、保存と呼び出し、「この日は作らない」の設定・解除、「選んだもの」の日への手割り当て、この献立の買い物リストを作る（U3 に材料を渡す）
- Touches: `db/migrations/004_meal_plan.sql`、`src/repo/mealplan/`、`src/domain/mealplan/`、`src/api/routes/mealplan.ts`、`src/app/meal-plan/`、`src/ui/mealplan/`。**U1 の候補の取得と Dish を拡張する**（下の一覧）
- Tests: 標準の戦略で約 50〜60 件（提案の制約、乱数を固定した検証 V1〜V10、やり直し、作らない日、保存と呼び出し、買い物リストへの受け渡し、他グループの拒否、画面の動作）

Full plan: aidlc/spaces/default/intents/261010-meal-planner/construction/meal-plan/code-generation/code-generation-plan.md
Test instructions: aidlc/spaces/default/intents/261010-meal-planner/construction/meal-plan/code-generation/unit-test-instructions.md

[Approval Fingerprint]: sha256:v3:903cccaeb6b03972ded2faa55d1e88d68a50d191c3b236e929446e9315a27af6
[Planned Source]: be47f5c353b55a53db170b0ac28464c78812e784ef07dc29d01deabd5f759c52


[Answer]: Plan approval off
