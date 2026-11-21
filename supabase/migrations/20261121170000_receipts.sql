-- Comprovantes: foto ou PDF anexado a um lançamento. O arquivo fica num bucket privado, sob o
-- prefixo do user_id (como o avatar); a tabela liga cada arquivo ao lançamento e some com ele.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy receipt_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy receipt_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy receipt_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy receipt_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  path text not null unique check (starts_with(path, user_id::text || '/')),
  thumb_path text check (thumb_path is null or starts_with(thumb_path, user_id::text || '/')),
  name text not null check (length(name) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes int not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  foreign key (user_id, transaction_id) references public.transactions (user_id, id) on delete cascade
);
create index receipts_transaction on public.receipts (user_id, transaction_id);
alter table public.receipts enable row level security;
create policy owner_access on public.receipts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.receipts from public, anon, authenticated;
grant select, insert, delete on public.receipts to authenticated;
