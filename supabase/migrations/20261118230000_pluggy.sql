-- Open Finance through Pluggy. Only the Cloudflare Worker (service role) writes these tables:
-- it validates every connection against Pluggy before storing it. Owners can read their rows.

alter table public.transactions drop constraint transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual','csv','ofx','invoice','recurring','installment','settlement','pluggy'));

-- One row per bank connection (Pluggy item) of a user.
create table public.pluggy_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null unique,
  connector_name text not null,
  status text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index pluggy_items_user on public.pluggy_items (user_id);

-- Which app account or card each Pluggy account feeds.
create table public.pluggy_accounts (
  pluggy_account_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.pluggy_items(item_id) on delete cascade,
  account_id uuid,
  card_id uuid,
  check (num_nonnulls(account_id, card_id) = 1),
  foreign key (user_id, account_id) references public.accounts (user_id, id) on delete cascade,
  foreign key (user_id, card_id) references public.cards (user_id, id) on delete cascade
);
create index pluggy_accounts_user on public.pluggy_accounts (user_id);

-- Webhook deliveries already handled (Pluggy may retry the same eventId).
create table public.pluggy_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

alter table public.pluggy_items enable row level security;
alter table public.pluggy_accounts enable row level security;
alter table public.pluggy_events enable row level security;
create policy owner_read on public.pluggy_items for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_read on public.pluggy_accounts for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.pluggy_items, public.pluggy_accounts, public.pluggy_events from public, anon, authenticated;
grant select on public.pluggy_items, public.pluggy_accounts to authenticated;
