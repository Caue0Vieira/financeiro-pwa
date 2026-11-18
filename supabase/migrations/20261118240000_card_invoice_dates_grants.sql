-- Supabase grants ALL on new tables to authenticated by default; keep only what the app uses
-- (TRUNCATE ignores RLS, so it must not be granted), like monthly_budgets.
revoke all on public.card_invoice_dates from public, anon, authenticated;
grant select, insert, update, delete on public.card_invoice_dates to authenticated;
