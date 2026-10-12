-- U3 買い物リスト（shopping-list）：追加だけの移行（既存の移行は変更しない）
-- 「作成中のリストは 1 件まで」は、同時に来ても守れるよう DB の制約で置く（BR20.2、BR20.14）。

create table shopping_lists (
  list_id          uuid primary key,
  household_id     uuid not null references households (household_id),
  -- picked = 「選んだもの」から作る。mealPlan = 献立（U4）が渡した材料から作る（ADR-010）
  source           text not null check (source in ('picked', 'mealPlan')),
  -- 献立の ID。ID だけの参照（ADR-009）なので外部キーは持たない
  source_plan_id   text check (source_plan_id is null or char_length(source_plan_id) between 1 and 100),
  status           text not null default 'active' check (status in ('active', 'completed')),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  -- 完了した人。ID だけの参照（ADR-009）
  completed_by     uuid references members (member_id),
  -- 完了時に確定する「選んだものから外す対象」の dishId の一覧と、外し終えたか（BR20.13）
  unpick_dish_ids  jsonb not null default '[]'::jsonb check (jsonb_typeof(unpick_dish_ids) = 'array'),
  unpick_done      boolean not null default false,
  check ((source = 'mealPlan') = (source_plan_id is not null)),
  check ((status = 'completed') = (completed_at is not null))
);
-- BR20.2：同じグループで、「選んだもの」から作る作成中のリストは 1 件まで
create unique index shopping_lists_active_picked_uq on shopping_lists (household_id)
  where source = 'picked' and status = 'active';
-- BR20.14：献立用のリストは、献立の ID ごとに作成中を 1 件まで
create unique index shopping_lists_active_plan_uq on shopping_lists (household_id, source_plan_id)
  where source = 'mealPlan' and status = 'active';
-- 外し残しのやり直しの探索（BR20.13）
create index shopping_lists_pending_unpick_idx on shopping_lists (household_id)
  where status = 'completed' and source = 'picked' and unpick_done = false;

create table shopping_items (
  item_id          uuid primary key,
  -- リストを消したら行も消える（BR20.15）
  list_id          uuid not null references shopping_lists (list_id) on delete cascade,
  household_id     uuid not null references households (household_id),
  -- 行の同一性の印（BR20.5〜BR20.8）。同期のとき同じ lineKey の行を同じ行とみなす
  line_key         text not null check (char_length(line_key) between 1 and 400),
  kind             text not null default 'ingredient' check (kind in ('ingredient', 'needsInput')),
  ingredient_name  text check (ingredient_name is null or char_length(ingredient_name) between 1 and 50),
  unit             text check (unit is null or char_length(unit) <= 20),
  amount_kind      text check (amount_kind in ('numeric', 'text', 'none')),
  amount_number    numeric check (amount_number is null or amount_number > 0),
  amount_text      text check (amount_text is null or char_length(amount_text) <= 30),
  -- 元の料理の dishId（重複なし、1 件以上）。削除済みの料理でも残す（ADR-008、ADR-009）
  source_dish_ids  jsonb not null
    check (jsonb_typeof(source_dish_ids) = 'array' and jsonb_array_length(source_dish_ids) >= 1),
  checked          boolean not null default false,
  checked_by       uuid references members (member_id),
  checked_at       timestamptz,
  constraint shopping_items_list_line_uq unique (list_id, line_key),
  -- 材料の行は材料名と分量の種類が必須。「材料の入力が必要」の行はチェックできない（BR20.8）
  check (kind <> 'ingredient' or (ingredient_name is not null and amount_kind is not null)),
  check ((amount_kind = 'numeric') = (amount_number is not null)),
  check (kind <> 'needsInput' or (checked = false and jsonb_array_length(source_dish_ids) = 1))
);
create index shopping_items_household_list_idx on shopping_items (household_id, list_id);
