alter table public.cards
  alter column closing_day drop not null,
  alter column due_day drop not null;

create or replace function public.add_installments(
  p_card uuid, p_description text, p_category text, p_total bigint, p_count int, p_first date
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  i int;
  cents bigint;
  grp uuid := gen_random_uuid();
  d date;
  invoice_date date;
  due int;
begin
  if auth.uid() is null or p_count < 1 or p_count > 360 or p_total >= 0 or p_first is null then
    raise exception 'Invalid installments';
  end if;
  select due_day into due from public.cards where id = p_card and user_id = auth.uid();
  if not found then raise exception 'Card not found'; end if;

  for i in 0..p_count-1 loop
    cents := -(abs(p_total)/p_count + case when i < abs(p_total)%p_count then 1 else 0 end);
    if cents = 0 then raise exception 'Installment cannot be zero'; end if;
    invoice_date := (date_trunc('month', p_first) + make_interval(months => i))::date;
    -- Cards without a due day use the last day only as the installment's planning date.
    d := invoice_date + least(coalesce(due, 31), extract(day from (invoice_date + interval '1 month - 1 day'))::int) - 1;
    insert into public.transactions(
      card_id, occurred_on, description, amount_cents, kind, category, status, source,
      installment_group_id, installment_number, installment_count, invoice_month
    ) values (
      p_card, d, p_description, cents, 'expense', p_category, 'planned', 'installment',
      grp, i+1, p_count, invoice_date
    );
  end loop;
end $$;
