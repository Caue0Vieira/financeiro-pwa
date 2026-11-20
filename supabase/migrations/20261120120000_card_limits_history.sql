-- Card limits and open invoice balance as Pluggy reports them (written only by the Worker), and
-- a marker for the one-time 12-month history import of each Open Finance connection.
alter table public.cards
  add column credit_limit_cents bigint,
  add column available_limit_cents bigint,
  add column bill_balance_cents bigint,
  add column limits_synced_at timestamptz;

alter table public.pluggy_items add column history_synced_at timestamptz;
