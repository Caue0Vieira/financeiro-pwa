-- Invoice closing day per card (the column already exists, nullable) and
-- per-month adjustments of the closing and due dates of a card's invoice.

drop function public.save_card(uuid, text, text, int);

create function public.save_card(
  p_id uuid, p_name text, p_bank text, p_due_day int, p_closing_day int default null
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  bank_name text := nullif(btrim(p_bank), '');
  bank_id uuid;
  previous_bank_id uuid;
begin
  if owner_id is null or nullif(btrim(p_name), '') is null then
    raise exception 'Informe o nome do cartão.';
  end if;

  if p_id is not null then
    select account_id into previous_bank_id
    from public.cards where id = p_id and user_id = owner_id for update;
    if not found then raise exception 'Cartão não encontrado.'; end if;
  end if;

  if bank_name is not null then
    -- Serialize lookup and creation for the same owner and bank name.
    perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':' || lower(bank_name), 0));
    select id into bank_id
    from public.accounts
    where user_id = owner_id and lower(btrim(name)) = lower(bank_name)
    order by (id = previous_bank_id) desc nulls last, created_at, id
    limit 1;

    if bank_id is null then
      insert into public.accounts (user_id, name) values (owner_id, bank_name) returning id into bank_id;
    end if;
  end if;

  if p_id is null then
    insert into public.cards (user_id, name, account_id, due_day, closing_day)
    values (owner_id, btrim(p_name), bank_id, p_due_day, p_closing_day);
  else
    update public.cards
    set name = btrim(p_name), account_id = bank_id, due_day = p_due_day, closing_day = p_closing_day
    where id = p_id and user_id = owner_id;
  end if;
end $$;

revoke all on function public.save_card(uuid, text, text, int, int) from public, anon;
grant execute on function public.save_card(uuid, text, text, int, int) to authenticated;

-- One row per card and invoice month when that month's dates differ from the card's days.
create table public.card_invoice_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id uuid not null,
  month date not null check (month = date_trunc('month', month)::date),
  closing_on date,
  due_on date,
  check (num_nonnulls(closing_on, due_on) > 0),
  check (closing_on is null or due_on is null or due_on > closing_on),
  foreign key (user_id, card_id) references public.cards (user_id, id) on delete cascade,
  unique (user_id, card_id, month)
);

alter table public.card_invoice_dates enable row level security;
create policy owner_access on public.card_invoice_dates for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.card_invoice_dates from public, anon;
grant select, insert, update, delete on public.card_invoice_dates to authenticated;
