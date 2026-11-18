-- Card model chosen by the user (e.g. Inter Prime, Nubank Ultravioleta), drawn by the app.
-- Null means the bank's standard card. Owners update it through the existing cards policy.
alter table public.cards
  add column design text check (design is null or design ~ '^[a-z0-9-]{1,40}$');
