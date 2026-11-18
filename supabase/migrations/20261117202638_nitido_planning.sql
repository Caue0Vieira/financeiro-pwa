create table public.monthly_budgets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  amount_cents bigint not null check (amount_cents >= 0),
  primary key (user_id, month)
);

alter table public.investments add constraint investments_owner_id unique (user_id, id);
create table public.investment_valuations (
  user_id uuid not null default auth.uid(),
  investment_id uuid not null,
  snapshot_on date not null,
  value_cents bigint not null check (value_cents >= 0),
  primary key (user_id, investment_id, snapshot_on),
  foreign key (user_id, investment_id) references public.investments(user_id, id) on delete cascade
);

alter table public.monthly_budgets enable row level security;
alter table public.investment_valuations enable row level security;
revoke all on public.monthly_budgets, public.investment_valuations from public, anon, authenticated;
grant select, insert, update on public.monthly_budgets, public.investment_valuations to authenticated;

create policy monthly_budgets_owner on public.monthly_budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy investment_valuations_owner on public.investment_valuations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into public.investment_valuations (user_id, investment_id, snapshot_on, value_cents)
select user_id, id, as_of, value_cents from public.investments;

create function public.nitido_record_valuation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.investment_valuations (user_id, investment_id, snapshot_on, value_cents)
  values (new.user_id, new.id, new.as_of, new.value_cents)
  on conflict (user_id, investment_id, snapshot_on) do update set value_cents = excluded.value_cents;
  return new;
end
$$;
revoke all on function public.nitido_record_valuation() from public, anon, authenticated;

create trigger nitido_record_valuation
after insert or update of value_cents, as_of on public.investments
for each row execute function public.nitido_record_valuation();

create function public.nitido_planning(p_month date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with changes as (
    select snapshot_on, value_cents - lag(value_cents, 1, 0::bigint) over (
      partition by user_id, investment_id order by snapshot_on
    ) as delta
    from public.investment_valuations
    where user_id = (select auth.uid())
  ), totals as (
    select snapshot_on as date, sum(sum(delta)) over (order by snapshot_on) as value
    from changes group by snapshot_on
  ), targets as (
    select g.id, g.name, g.target_cents as amount, coalesce(sum(c.amount_cents), 0) as saved
    from public.savings_goals g
    left join public.goal_contributions c on c.user_id = g.user_id and c.goal_id = g.id
    where g.user_id = (select auth.uid())
    group by g.id, g.name, g.target_cents
  )
  select jsonb_build_object(
    'budget', coalesce((
      select amount_cents from public.monthly_budgets
      where user_id = (select auth.uid()) and month = date_trunc('month', p_month)::date
    ), 0),
    'targets', coalesce((select jsonb_agg(targets order by name, id) from targets), '[]'::jsonb),
    'valuations', coalesce((select jsonb_agg(totals order by date) from totals), '[]'::jsonb)
  );
$$;

create function public.nitido_expense_days(p_start date, p_end date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(expenses order by date, category), '[]'::jsonb)
  from (
    select occurred_on as date, category, -sum(amount_cents) as amount
    from public.transactions
    where user_id = (select auth.uid()) and occurred_on >= p_start and occurred_on < p_end
      and p_end - p_start between 1 and 732
      and status = 'confirmed' and kind in ('expense', 'refund')
    group by occurred_on, category
  ) expenses;
$$;
revoke all on function public.nitido_planning(date), public.nitido_expense_days(date, date) from public, anon;
grant execute on function public.nitido_planning(date), public.nitido_expense_days(date, date) to authenticated;
