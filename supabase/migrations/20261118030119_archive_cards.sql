alter table public.cards
  add column archived boolean not null default false;
