-- Recurring bills and subscriptions can be charged on a card: the rule keeps the card,
-- and each month's charge joins that card's invoice instead of the cash to pay.
-- recurring_rules.card_id already exists (with a foreign key to the owner's cards); this stores it.
create or replace function public.save_recurrence(p_data jsonb, p_effective date default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  old public.recurring_rules%rowtype;
  result uuid;
  effective date;
  card uuid := nullif(p_data->>'cardId', '')::uuid;
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
        card_id = card
      where id = old.id
      returning id into result;
      return result;
    end if;
    update public.recurring_rules set ends_on = (effective - interval '1 day')::date where id = old.id;
  else
    effective := (p_data->>'startMonth')::date;
  end if;
  insert into public.recurring_rules(description, amount_cents, kind, category, day_of_month, starts_on, ends_on, card_id)
  values (
    p_data->>'description', (p_data->>'amount')::bigint, p_data->>'kind', p_data->>'category',
    (p_data->>'day')::int, effective, nullif(p_data->>'endMonth', '')::date, card
  )
  returning id into result;
  return result;
end $$;
revoke all on function public.save_recurrence(jsonb, date) from public, anon;
grant execute on function public.save_recurrence(jsonb, date) to authenticated;
