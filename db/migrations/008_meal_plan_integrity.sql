-- U4 献立の整合性強化（R-01、R-02）。004 適用済みの DB にも追加適用できる。

-- 既存データに不整合がある場合は、黙って制約を追加せず移行を止める。
do $$
begin
  if exists (
    select 1
    from meal_plans p
    where (select count(*) from plan_days d where d.plan_id = p.plan_id) <> 7
       or exists (
         select 1
         from generate_series(0, 6) as expected(day_offset)
         where not exists (
           select 1 from plan_days d
           where d.plan_id = p.plan_id
             and d.date = p.start_date + expected.day_offset
         )
       )
       or exists (
         select 1 from plan_days d
         where d.plan_id = p.plan_id
           and (d.date < p.start_date or d.date > p.start_date + 6)
       )
  ) then
    raise exception '既存の meal_plans に 7 日連続ではない献立があります';
  end if;
end
$$;

-- 既存移行で作られたテーブルにも、親と所属の組み合わせを参照させる。
create unique index if not exists dishes_dish_household_uq on dishes (dish_id, household_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meal_plans_plan_household_uq'
  ) then
    alter table meal_plans
      add constraint meal_plans_plan_household_uq unique (plan_id, household_id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'plan_days_plan_household_fk'
  ) then
    alter table plan_days
      add constraint plan_days_plan_household_fk
      foreign key (plan_id, household_id)
      references meal_plans (plan_id, household_id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'plan_days_dish_household_fk'
  ) then
    alter table plan_days
      add constraint plan_days_dish_household_fk
      foreign key (dish_id, household_id)
      references dishes (dish_id, household_id);
  end if;
end
$$;

-- 献立の作成・変更・削除を取引のコミット時に検査する。行を 1 件ずつ作る
-- insertPlan も、最終状態が 7 日であれば通過できるよう遅延制約にする。
create or replace function enforce_meal_plan_seven_days()
returns trigger
language plpgsql
as $$
declare
  target_plan_id uuid;
  plan_start_date date;
  day_count integer;
  day_offset integer;
begin
  if tg_op = 'DELETE' then
    target_plan_id := old.plan_id;
  else
    target_plan_id := new.plan_id;
  end if;

  select start_date into plan_start_date
    from meal_plans where plan_id = target_plan_id;

  -- 親の削除に伴う cascade の子削除は検査対象外。
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select count(*) into day_count from plan_days where plan_id = target_plan_id;
  if day_count <> 7 then
    raise exception 'meal plan % must contain exactly 7 days', target_plan_id
      using errcode = 'check_violation';
  end if;

  for day_offset in 0..6 loop
    if not exists (
      select 1 from plan_days
      where plan_id = target_plan_id
        and date = plan_start_date + day_offset
    ) then
      raise exception 'meal plan % must contain consecutive dates from start_date', target_plan_id
        using errcode = 'check_violation';
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'meal_plans_seven_days_trigger'
  ) then
    create constraint trigger meal_plans_seven_days_trigger
      after insert or update of start_date on meal_plans
      deferrable initially deferred
      for each row execute function enforce_meal_plan_seven_days();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'plan_days_seven_days_trigger'
  ) then
    create constraint trigger plan_days_seven_days_trigger
      after insert or update or delete on plan_days
      deferrable initially deferred
      for each row execute function enforce_meal_plan_seven_days();
  end if;
end
$$;
