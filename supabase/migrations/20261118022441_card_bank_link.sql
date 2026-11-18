alter table public.cards
  add column account_id uuid,
  add constraint cards_bank_account_fkey
    foreign key (user_id, account_id) references public.accounts (user_id, id);

create index cards_bank_account_idx on public.cards (user_id, account_id);

-- Previous card registrations used the institution as the card name.
-- Link an existing account when the name has exactly one match.
with named_accounts as (
  select user_id, lower(btrim(name)) as bank_name, (array_agg(id))[1] as id
  from public.accounts
  group by user_id, lower(btrim(name))
  having count(*) = 1
)
update public.cards as card
set account_id = named_accounts.id
from named_accounts
where card.user_id = named_accounts.user_id and lower(btrim(card.name)) = named_accounts.bank_name;

create function public.save_card(p_id uuid, p_name text, p_bank text, p_due_day int)
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
    insert into public.cards (user_id, name, account_id, due_day)
    values (owner_id, btrim(p_name), bank_id, p_due_day);
  else
    update public.cards set name = btrim(p_name), account_id = bank_id, due_day = p_due_day
    where id = p_id and user_id = owner_id;
  end if;
end $$;

revoke all on function public.save_card(uuid,text,text,int) from public, anon;
grant execute on function public.save_card(uuid,text,text,int) to authenticated;
