-- Automatic categorisation: rules learned from the user's own corrections, applied by the Worker
-- to new transactions; what no rule or built-in pattern covers is classified by Workers AI.

-- Same normalisation as descriptionKey() in src/worker/categorize.ts (keep both in sync).
create function public.description_key(p text) returns text language sql immutable set search_path='' as $$
  select btrim(left(btrim(regexp_replace(lower(translate(coalesce(p,''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),'[^a-z]+',' ','g')),200))
$$;
grant execute on function public.description_key(text) to authenticated;

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description_key text not null check (length(description_key) between 3 and 200),
  category text not null check (length(btrim(category)) between 1 and 60),
  updated_at timestamptz not null default now(),
  unique (user_id, description_key)
);
alter table public.category_rules enable row level security;
create policy owner_access on public.category_rules for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.category_rules to authenticated;

-- Who chose the category: 'rule' (learned rule), 'ai' (Workers AI; 'Sem categoria' there means
-- the model was unsure and it is not asked again) or null (the user, an import or a built-in pattern).
alter table public.transactions add column category_source text check (category_source in ('rule','ai'));
grant update (category_source) on public.transactions to authenticated;

/**
 * When the user changes a category, remember it for that description and fix the other
 * transactions with the same description that were categorised automatically (or not at all).
 * Writes by the Worker (service role, no auth.uid()) and the nested update below are ignored.
 */
create function public.learn_category() returns trigger language plpgsql security invoker set search_path='' as $$
declare
  k text := public.description_key(new.description);
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 or new.category is not distinct from old.category then
    return new;
  end if;
  new.category_source := null;
  if btrim(new.category) in ('', 'Sem categoria') or new.kind in ('card_payment', 'refund') or length(k) < 3
     or k in ('pix', 'pix enviado', 'pix recebido', 'pix qr code', 'transferencia', 'transferencia enviada',
              'transferencia recebida', 'ted', 'doc', 'compra', 'compras', 'pagamento', 'debito', 'credito',
              'saque', 'lancamento', 'deposito') then
    return new;
  end if;
  insert into public.category_rules(user_id, description_key, category)
  values (new.user_id, k, btrim(new.category))
  on conflict (user_id, description_key) do update set category = excluded.category, updated_at = now();
  update public.transactions t set category = btrim(new.category), category_source = 'rule'
  where t.user_id = new.user_id and t.id <> new.id and t.source <> 'settlement'
    and (t.category_source is not null or t.category = 'Sem categoria')
    and t.category <> btrim(new.category)
    and t.kind not in ('card_payment', 'refund')
    and public.description_key(t.description) = k;
  return new;
end $$;
create trigger transactions_learn_category before update of category on public.transactions
  for each row execute function public.learn_category();

-- The Worker looks for what is still uncategorised.
create index transactions_uncategorised on public.transactions(user_id, occurred_on desc)
  where category = 'Sem categoria' and category_source is null;
