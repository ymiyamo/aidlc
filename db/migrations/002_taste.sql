-- U2 好き嫌いと絞り込み（taste-filter）：追加だけの移行（001 は変更しない）
-- 同じメンバーの同じ食材は 1 件まで。同時に来ても 1 件に保つための最後の守りを、DB の制約で置く（BR10.2）。

create table disliked_ingredients (
  dislike_id      uuid primary key,
  household_id    uuid not null references households (household_id),
  -- 人の参照は memberId だけ（ADR-009）。メンバーが抜けたら、アプリ内の呼び出しで消す（BR10.21）
  member_id       uuid not null references members (member_id),
  -- 前後の空白を除いた 1〜50 文字。正規化はしない（BR10.1、BR10.7）
  ingredient_name text not null check (char_length(ingredient_name) between 1 and 50),
  registered_at   timestamptz not null default now(),
  constraint disliked_ingredients_member_name_uq unique (member_id, ingredient_name)
);
-- 除外一覧（グループ全員分）の取得（BR10.6）
create index disliked_ingredients_household_idx on disliked_ingredients (household_id);
