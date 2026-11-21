-- Notificações push (Web Push com VAPID). Cada aparelho grava a própria inscrição e escolhe
-- quais avisos quer receber; o Worker (service role) lê as inscrições no cron e envia os avisos.

-- Limite de gasto por categoria, igual para todos os meses. Alimenta o aviso de 80% e 100%.
create table public.category_budgets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (length(btrim(category)) between 1 and 60),
  amount_cents bigint not null check (amount_cents > 0),
  primary key (user_id, category)
);
alter table public.category_budgets enable row level security;
create policy owner_access on public.category_budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.category_budgets from public, anon, authenticated;
grant select, insert, update, delete on public.category_budgets to authenticated;

-- Uma linha por aparelho. `preferences` guarda as chaves de cada tipo de aviso e o valor mínimo
-- do aviso de gasto alto; o app e o Worker completam o que faltar com os padrões.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'),
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object' and length(preferences::text) <= 2000),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy owner_access on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.push_subscriptions from public, anon, authenticated;
-- O app só escreve a inscrição e as preferências; o último envio é do Worker.
grant select, insert, delete on public.push_subscriptions to authenticated;
-- endpoint entra porque o upsert do app (on conflict endpoint) regrava a coluna.
grant update (endpoint, p256dh, auth, preferences, user_agent) on public.push_subscriptions to authenticated;

-- O que já foi avisado, para não repetir (ex.: a mesma conta vencendo amanhã a cada hora).
-- Só o Worker lê e escreve.
create table public.notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  ref text not null check (length(ref) between 1 and 200),
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
create index notification_log_sent on public.notification_log (sent_at);
alter table public.notification_log enable row level security;
revoke all on public.notification_log from public, anon, authenticated;

-- Gasto confirmado por categoria no mês (mesma regra do painel), para os usuários informados.
-- Uma chamada atende todos os usuários do cron; só o Worker executa.
create function public.notification_spending(p_month date, p_users uuid[])
returns table (user_id uuid, category text, spent bigint)
language sql stable security invoker set search_path = '' as $$
  select t.user_id, t.category, (-sum(t.amount_cents))::bigint
  from public.transactions t
  where t.user_id = any(p_users)
    and t.status = 'confirmed' and t.kind in ('expense', 'refund') and t.source <> 'settlement'
    and t.occurred_on >= date_trunc('month', p_month)::date
    and t.occurred_on < (date_trunc('month', p_month) + interval '1 month')::date
  group by t.user_id, t.category;
$$;
revoke all on function public.notification_spending(date, uuid[]) from public, anon, authenticated;
grant execute on function public.notification_spending(date, uuid[]) to service_role;
