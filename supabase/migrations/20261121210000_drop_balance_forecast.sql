-- Remove a previsão de saldo: o painel, o aviso push de saldo negativo e o saldo bancário que
-- servia de ponto de partida (gravado pelo Worker a cada sincronização da Pluggy).

drop table if exists public.balance_forecasts;

alter table public.pluggy_accounts
  drop column if exists balance_cents,
  drop column if exists balance_synced_at;
