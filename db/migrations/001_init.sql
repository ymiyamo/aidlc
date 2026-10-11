-- U1 最小の通し版：初期のスキーマ（entities.md に対応）
-- 一意制約は「同時に来ても 1 件に保つ」ための最後の守り（NFR7.4〜7.7）。

create table accounts (
  account_id      uuid primary key,
  email           text not null check (char_length(email) between 3 and 254),
  password_digest text not null,
  -- 登録のときの表示名。グループ作成のとき Member の表示名の初期値になる
  display_name    text check (display_name is null or char_length(display_name) between 1 and 50),
  created_at      timestamptz not null default now()
);
-- BR1.2：メールアドレスは大文字小文字を区別せず一意
create unique index accounts_email_lower_uq on accounts (lower(email));

-- BR1.5：session_id には、Cookie の値の変換値（ハッシュ）を保存する。元の値は保存しない
create table login_sessions (
  session_id text primary key,
  account_id uuid not null references accounts (account_id) on delete cascade,
  issued_at  timestamptz not null,
  expires_at timestamptz not null
);
create index login_sessions_account_idx on login_sessions (account_id);

create table households (
  household_id uuid primary key,
  name         text not null check (char_length(name) between 1 and 50),
  created_at   timestamptz not null default now()
);

create table members (
  member_id    uuid primary key,
  household_id uuid not null references households (household_id),
  account_id   uuid references accounts (account_id),
  display_name text check (display_name is null or char_length(display_name) between 1 and 50),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz
);
-- BR2.1：有効な Member（left_at が空）は 1 アカウントにつき最大 1 件
create unique index members_active_account_uq on members (account_id)
  where left_at is null and account_id is not null;
create index members_household_idx on members (household_id);

create table dishes (
  dish_id      uuid primary key,
  household_id uuid not null references households (household_id),
  name         text not null check (char_length(name) between 1 and 100),
  url          text not null check (char_length(url) <= 2000 and url ~ '^https?://'),
  cook_time    text check (cook_time in ('within15', 'within30', 'over30')),
  effort       text check (effort in ('easy', 'normal', 'hard')),
  mood_tags    jsonb not null default '[]'::jsonb
    check (jsonb_typeof(mood_tags) = 'array' and jsonb_array_length(mood_tags) <= 5),
  memo         text check (memo is null or char_length(memo) <= 1000),
  is_favorite  boolean not null default false,
  source       text not null default 'user' check (source in ('user', 'seed')),
  seed_key     text,
  created_by   uuid references members (member_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  check ((source = 'seed') = (seed_key is not null))
);
-- BR3.12：初期データは（グループ、seedKey）で一意。削除済みも含めて 1 件
create unique index dishes_seed_uq on dishes (household_id, seed_key) where seed_key is not null;
create index dishes_household_updated_idx on dishes (household_id, updated_at desc)
  where deleted_at is null;

create table dish_ingredients (
  dish_id         uuid not null references dishes (dish_id) on delete cascade,
  position        integer not null,
  ingredient_name text not null check (char_length(ingredient_name) between 1 and 50),
  amount          text check (amount is null or char_length(amount) <= 30),
  unit            text check (unit is null or char_length(unit) <= 20),
  primary key (dish_id, position)
);

create table picked_items (
  picked_id    uuid primary key,
  household_id uuid not null references households (household_id),
  dish_id      uuid not null references dishes (dish_id),
  member_id    uuid not null references members (member_id),
  picked_at    timestamptz not null default now(),
  -- BR4.7：同じグループで同じ料理は 1 件まで
  constraint picked_items_household_dish_uq unique (household_id, dish_id)
);
