-- Recurrences can be recorded by themselves on their day (salary, automatic debit): when the
-- month's charge is due, the app inserts it as confirmed instead of leaving it as "Previsto".
-- The unique index transactions_recurring_period keeps it to one transaction per rule and month.
alter table public.recurring_rules add column if not exists auto_record boolean not null default false;

create or replace function public.save_recurrence(p_data jsonb, p_effective date default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  old public.recurring_rules%rowtype;
  result uuid;
  effective date;
  card uuid := nullif(p_data->>'cardId', '')::uuid;
  auto boolean := coalesce((p_data->>'autoRecord')::boolean, false) and card is null;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if card is not null and p_data->>'kind' = 'income' then raise exception 'Income cannot be charged on a card'; end if;
  if nullif(p_data->>'id', '') is not null then
    select * into old from public.recurring_rules where id = (p_data->>'id')::uuid and user_id = uid for update;
    if not found then raise exception 'Recurrence not found'; end if;
    effective := greatest(
      date_trunc('month', coalesce(p_effective, current_date))::date,
      date_trunc('month', old.starts_on)::date
    );
    if effective <= date_trunc('month', old.starts_on)::date then
      update public.recurring_rules set
        description = p_data->>'description',
        amount_cents = (p_data->>'amount')::bigint,
        kind = p_data->>'kind',
        category = p_data->>'category',
        day_of_month = (p_data->>'day')::int,
        starts_on = (p_data->>'startMonth')::date,
        ends_on = nullif(p_data->>'endMonth', '')::date,
        card_id = card,
        auto_record = auto
      where id = old.id
      returning id into result;
      return result;
    end if;
    -- Turning the option on or off alone changes no amount or date: it applies to the rule as is.
    if old.description = p_data->>'description' and old.amount_cents = (p_data->>'amount')::bigint
      and old.kind = p_data->>'kind' and old.category = p_data->>'category'
      and old.day_of_month = (p_data->>'day')::int and old.card_id is not distinct from card
      and date_trunc('month', old.ends_on) is not distinct from date_trunc('month', nullif(p_data->>'endMonth', '')::date) then
      update public.recurring_rules set auto_record = auto where id = old.id returning id into result;
      return result;
    end if;
    update public.recurring_rules set ends_on = (effective - interval '1 day')::date where id = old.id;
  else
    effective := (p_data->>'startMonth')::date;
  end if;
  insert into public.recurring_rules(description, amount_cents, kind, category, day_of_month, starts_on, ends_on, card_id, auto_record)
  values (
    p_data->>'description', (p_data->>'amount')::bigint, p_data->>'kind', p_data->>'category',
    (p_data->>'day')::int, effective, nullif(p_data->>'endMonth', '')::date, card, auto
  )
  returning id into result;
  return result;
end $$;
revoke all on function public.save_recurrence(jsonb, date) from public, anon;
grant execute on function public.save_recurrence(jsonb, date) to authenticated;
