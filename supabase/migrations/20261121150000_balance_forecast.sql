-- Previsão de saldo: o ponto de partida é o saldo das contas que vem do Open Finance (guardado em
-- cada conta da Pluggy pelo Worker). A previsão é calculada no app (src/forecast.ts); quando ela
-- mostra um dia negativo, o app grava esse dia aqui para o cron mandar o push.

alter table public.pluggy_accounts
  add column balance_cents bigint,
  add column balance_synced_at timestamptz;

create table public.balance_forecasts (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  negative_on date,
  lowest_cents bigint not null,
  updated_at timestamptz not null default now(),
  check (negative_on is null or date_trunc('month', negative_on)::date = month)
);
alter table public.balance_forecasts enable row level security;
create policy owner_access on public.balance_forecasts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.balance_forecasts from public, anon, authenticated;
grant select, insert, update on public.balance_forecasts to authenticated;
