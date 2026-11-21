-- Detector de assinaturas: o app encontra cobranças recorrentes (mesmo estabelecimento, valor
-- parecido, intervalo mensal ou anual) em src/subscriptions.ts. A decisão do usuário (confirmar ou
-- ignorar) fica guardada por estabelecimento e vale para as próximas detecções, como em category_rules.

create table public.subscription_decisions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant_key text not null check (length(merchant_key) between 2 and 120),
  status text not null check (status in ('confirmed', 'ignored')),
  updated_at timestamptz not null default now(),
  primary key (user_id, merchant_key)
);
alter table public.subscription_decisions enable row level security;
create policy owner_access on public.subscription_decisions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.subscription_decisions from public, anon, authenticated;
grant select, insert, update, delete on public.subscription_decisions to authenticated;

-- Despesas avulsas (sem parcelas) desde p_since, agrupadas pela descrição normalizada, numa única
-- resposta. Com RLS o app só vê as próprias; o Worker (service role) pede as dos usuários do cron.
create function public.subscription_charges(p_since date, p_users uuid[] default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', g.user_id, 'description', g.description, 'charges', g.charges)), '[]'::jsonb)
  from (
    select t.user_id, max(t.description) as description,
           jsonb_agg(jsonb_build_array(t.occurred_on, -t.amount_cents) order by t.occurred_on) as charges
    from public.transactions t
    where t.occurred_on >= p_since and t.status = 'confirmed' and t.kind = 'expense' and t.amount_cents < 0
      and coalesce(t.installment_count, 1) <= 1 and t.source <> 'settlement'
      and (p_users is null or t.user_id = any(p_users))
    group by t.user_id, public.description_key(t.description)
  ) g;
$$;
revoke all on function public.subscription_charges(date, uuid[]) from public, anon;
grant execute on function public.subscription_charges(date, uuid[]) to authenticated, service_role;
