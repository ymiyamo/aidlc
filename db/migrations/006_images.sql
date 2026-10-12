-- U6 画像（images）：追加だけの移行（001 は変更しない）
-- 同じ料理に登録画像・生成画像は 1 件まで。同時に来ても 1 件に保つための最後の守りを、DB の制約で置く（BR60.5、BR60.7）。

-- 利用者が登録した画像（1 料理に 1 枚）。実体は保管の抽象の後ろに置き、ここには場所の名前だけを持つ
create table registered_images (
  image_id     uuid primary key,
  household_id uuid not null references households (household_id),
  -- 料理は論理削除（ADR-008）。ID だけの参照（ADR-009）
  dish_id      uuid not null references dishes (dish_id),
  -- ファイルの中身から判定した形式（BR60.1）
  content_type text not null check (content_type in ('jpeg', 'png', 'webp', 'gif')),
  -- 5MB = 5×1024×1024 バイト以下（BR60.2）
  byte_size    integer not null check (byte_size between 1 and 5242880),
  -- 推測できない保管の場所の名前。公開しない
  storage_key  text not null,
  uploaded_by  uuid references members (member_id),
  uploaded_at  timestamptz not null default now(),
  constraint registered_images_dish_uq unique (dish_id)
);
create index registered_images_household_idx on registered_images (household_id);

-- 生成画像と、その作成の状態（pending は requestedAt から 10 分で期限切れ。BR60.7）
create table generated_images (
  generated_image_id uuid primary key,
  household_id       uuid not null references households (household_id),
  dish_id            uuid not null references dishes (dish_id),
  status             text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  -- 最初の 1 回 + 再試行 3 回まで
  attempt_count      integer not null default 0 check (attempt_count between 0 and 4),
  storage_key        text,
  content_type       text check (content_type in ('jpeg', 'png', 'webp', 'gif')),
  requested_at       timestamptz not null,
  completed_at       timestamptz,
  constraint generated_images_dish_uq unique (dish_id),
  -- ready のときだけ、場所の名前と形式を持つ
  constraint generated_images_ready_ck
    check (
      (status = 'ready') = (storage_key is not null and content_type is not null)
      and ((storage_key is null) = (content_type is null))
    )
);
create index generated_images_household_idx on generated_images (household_id);
