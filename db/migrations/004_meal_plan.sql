-- U4 献立（meal-plan）：追加だけの移行（既存の移行は変更しない）
-- 「作業中の献立は 1 グループにつき 1 件」「1 つの献立に同じ日は 1 件」は、同時に来ても守れるよう DB の制約で置く
-- （BR30.15、entities.md）。

-- 料理の「主な食材の種類」（BR30.4、BR30.19）。未入力でもよい（null は「種類なし」で、3 日続きの判定に使わない）
alter table dishes
  add column ingredient_kind text
  check (ingredient_kind is null or ingredient_kind in ('meat', 'fish', 'vegetable', 'egg_soy', 'other'));

-- すでに作ってある初期データ（seed_key あり）にも種類を付ける。data/seed-dishes.json と同じ対応（BR30.19）
update dishes set ingredient_kind = case seed_key
  when 'nikujaga' then 'meat'
  when 'buta-shogayaki' then 'meat'
  when 'saba-misoni' then 'fish'
  when 'chicken-teriyaki' then 'meat'
  when 'oyakodon' then 'egg_soy'
  when 'tonjiru' then 'meat'
  when 'tamagoyaki' then 'egg_soy'
  when 'yakizakana' then 'fish'
  when 'kinpira' then 'vegetable'
  when 'hiyayakko-udon' then 'other'
  when 'karaage' then 'meat'
  when 'sukiyaki-don' then 'meat'
  when 'curry-rice' then 'meat'
  when 'hamburg' then 'meat'
  when 'cream-stew' then 'meat'
  when 'omurice' then 'egg_soy'
  when 'napolitan' then 'other'
  when 'gratin' then 'other'
  when 'caesar-salad' then 'vegetable'
  when 'mabo-tofu' then 'egg_soy'
  when 'chinjao-rosu' then 'meat'
  when 'gyoza' then 'meat'
  when 'chahan' then 'egg_soy'
  when 'ebichili' then 'fish'
  when 'harusame-salad' then 'vegetable'
  when 'tori-mizutaki' then 'meat'
  when 'yasai-itame' then 'vegetable'
  when 'nasu-dengaku' then 'vegetable'
  when 'potato-salad' then 'vegetable'
  when 'okonomiyaki' then 'other'
  else null
end
where seed_key is not null and ingredient_kind is null;

create table meal_plans (
  plan_id      uuid primary key,
  household_id uuid not null references households (household_id),
  -- 1 日目（日本時間の暦の日）
  start_date   date not null,
  is_saved     boolean not null default false,
  name         text check (name is null or char_length(name) between 1 and 50),
  -- 作った人。ID だけの参照（ADR-009）。退会後も行は残る（BR2.5）
  created_by   uuid not null references members (member_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  saved_at     timestamptz,
  check (is_saved = (saved_at is not null)),
  constraint meal_plans_plan_household_uq unique (plan_id, household_id)
);
create index meal_plans_household_idx on meal_plans (household_id, is_saved, saved_at desc);
-- BR30.15：作業中（保存していない）の献立は、グループにつき 1 件まで
create unique index meal_plans_working_uq on meal_plans (household_id) where is_saved = false;

create unique index dishes_dish_household_uq on dishes (dish_id, household_id);

create table plan_days (
  plan_day_id  uuid primary key,
  -- 献立を消したら日も消える（BR30.15、BR30.22）
  plan_id      uuid not null references meal_plans (plan_id) on delete cascade,
  -- 問い合わせを絞るため、親と同じ値を持つ（ADR-005）。親との所属整合性は複合 FK でも守る
  household_id uuid not null references households (household_id),
  date         date not null,
  day_status   text not null default 'empty' check (day_status in ('assigned', 'skip', 'empty')),
  -- 料理の ID だけの参照（ADR-009）。削除済みの料理を指していてもよい（ADR-008）
  dish_id      uuid references dishes (dish_id),
  origin       text check (origin in ('suggested', 'assigned_by_user')),
  empty_reason text check (empty_reason in
    ('not_enough_dishes', 'no_valid_combination', 'not_proposed', 'dish_unavailable')),
  -- BR30.1：1 つの献立に同じ日は 1 件まで
  constraint plan_days_plan_date_uq unique (plan_id, date),
  -- 献立と日行は同じグループに属する（R-02）。料理も同じグループに限定する
  constraint plan_days_plan_household_fk
    foreign key (plan_id, household_id) references meal_plans (plan_id, household_id) on delete cascade,
  constraint plan_days_dish_household_fk
    foreign key (dish_id, household_id) references dishes (dish_id, household_id),
  check (day_status <> 'assigned' or (dish_id is not null and origin is not null and empty_reason is null)),
  check (day_status <> 'skip' or (dish_id is null and origin is null and empty_reason is null)),
  check (day_status <> 'empty' or (dish_id is null and origin is null and empty_reason is not null))
);
create index plan_days_household_plan_idx on plan_days (household_id, plan_id);
