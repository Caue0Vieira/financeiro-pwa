-- B3 assets (stocks, FIIs, ETFs, BDRs) priced automatically: the Worker multiplies the quantity by
-- the latest quote and updates value_cents/as_of, so nitido_record_valuation keeps the daily history.
alter table public.investments
  add column ticker text check (ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
  add column quantity numeric(20, 8) check (quantity > 0),
  add column price_cents bigint check (price_cents >= 0),
  add column quoted_at timestamptz,
  add constraint investments_ticker_quantity check ((ticker is null) = (quantity is null));

create index investments_ticker on public.investments(ticker) where ticker is not null;
