-- Tags livres por lançamento (ex.: "viagem-rio", "reforma"), usadas na busca avançada e no total
-- por tag em Análise. Até 10 por lançamento, em minúsculas e sem espaços nas pontas.

create function public.tags_valid(p_tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(length(t) between 1 and 30 and t = lower(btrim(t))), true) from unnest(p_tags) t
$$;
revoke all on function public.tags_valid(text[]) from public, anon;
grant execute on function public.tags_valid(text[]) to authenticated, service_role;

alter table public.transactions
  add column tags text[] not null default '{}'
  check (cardinality(tags) <= 10 and public.tags_valid(tags));
create index transactions_tags on public.transactions using gin (tags);

-- A tabela tem permissões por coluna: a nova coluna precisa ser liberada.
grant insert (tags), update (tags) on public.transactions to authenticated;
