-- U5 作った記録（cook-log）：追加だけの移行（001 は変更しない）
-- 同じ料理の同じ日は 1 件まで。同時に来ても 1 件に保つための最後の守りを、DB の制約で置く（BR40.4）。

create table cook_records (
  record_id    uuid primary key,
  household_id uuid not null references households (household_id),
  -- 料理は論理削除（ADR-008）。料理が削除済みでも記録は残すので、削除の連鎖は持たない（BR40.11）
  dish_id      uuid not null references dishes (dish_id),
  member_id    uuid not null references members (member_id),
  -- 時刻を持たない、日本時間の暦の日（BR40.22）
  cooked_on    date not null,
  impression   text check (impression in ('again', 'never_again')),
  caution_memo text check (caution_memo is null or char_length(caution_memo) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint cook_records_household_dish_day_uq unique (household_id, dish_id, cooked_on)
);
-- 月ごとの取得（BR40.13）
create index cook_records_household_day_idx on cook_records (household_id, cooked_on desc);
-- 料理ごとの取得・最新の感想（BR40.7、BR40.19）
create index cook_records_dish_day_idx on cook_records (household_id, dish_id, cooked_on desc);
