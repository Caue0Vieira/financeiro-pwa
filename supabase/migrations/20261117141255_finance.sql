-- Private finance data. All amounts are integer cents and dates are calendar dates.
create extension if not exists pgcrypto;

create table public.accounts (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, name text not null, opening_balance_cents bigint not null default 0, created_at timestamptz not null default now(), unique(user_id,id));
create table public.cards (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, name text not null, closing_day int not null check(closing_day between 1 and 31), due_day int not null check(due_day between 1 and 31), created_at timestamptz not null default now(), unique(user_id,id));
create table public.categories (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, name text not null, color text, kind text not null check(kind in ('income','expense','both')), unique(user_id,id));
create table public.import_batches (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, account_id uuid, card_id uuid, file_hash text not null check(file_hash ~ '^[0-9a-f]{64}$'), filename text not null, imported_at timestamptz not null default now(), coverage_start date, coverage_end date, check(num_nonnulls(account_id,card_id)=1), check(coverage_start is null or coverage_end is null or coverage_end >= coverage_start), foreign key(user_id,account_id) references public.accounts(user_id,id), foreign key(user_id,card_id) references public.cards(user_id,id), unique(user_id,id));
create unique index import_account_hash on public.import_batches(user_id,account_id,file_hash) where account_id is not null;
create unique index import_card_hash on public.import_batches(user_id,card_id,file_hash) where card_id is not null;
create table public.recurring_rules (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, description text not null, amount_cents bigint not null check(amount_cents <> 0), day_of_month int not null check(day_of_month between 1 and 31), starts_on date not null, ends_on date, account_id uuid, card_id uuid, category_id uuid, foreign key(user_id,account_id) references public.accounts(user_id,id), foreign key(user_id,card_id) references public.cards(user_id,id), foreign key(user_id,category_id) references public.categories(user_id,id), check(num_nonnulls(account_id,card_id)=1), unique(user_id,id));
create table public.transactions (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, account_id uuid, card_id uuid, category_id uuid, occurred_on date not null, description text not null, amount_cents bigint not null check(amount_cents <> 0), status text not null default 'confirmed' check(status in ('confirmed','planned','review')), source text not null default 'manual' check(source in ('manual','csv','ofx','invoice','recurring','installment','settlement')), import_batch_id uuid, source_row int, external_id text, recurring_rule_id uuid, installment_group_id uuid, installment_number int, installment_count int, notes text, created_at timestamptz not null default now(), foreign key(user_id,account_id) references public.accounts(user_id,id), foreign key(user_id,card_id) references public.cards(user_id,id), foreign key(user_id,category_id) references public.categories(user_id,id), foreign key(user_id,import_batch_id) references public.import_batches(user_id,id), foreign key(user_id,recurring_rule_id) references public.recurring_rules(user_id,id), check(num_nonnulls(account_id,card_id)<=1), unique(user_id,id));
create index transactions_month on public.transactions(user_id,occurred_on desc,id desc);
create index transactions_category_month on public.transactions(user_id,category_id,occurred_on);
create unique index transactions_ofx_account on public.transactions(user_id,account_id,external_id) where account_id is not null and external_id is not null;
create unique index transactions_ofx_card on public.transactions(user_id,card_id,external_id) where card_id is not null and external_id is not null;
create unique index transactions_recurring_month on public.transactions(user_id,recurring_rule_id,occurred_on) where recurring_rule_id is not null;
create table public.invoices (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, card_id uuid not null, month date not null check(month=date_trunc('month',month)::date), amount_cents bigint not null check(amount_cents>0), foreign key(user_id,card_id) references public.cards(user_id,id), unique(user_id,id), unique(user_id,card_id,month));
create table public.invoice_payments (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, invoice_id uuid not null, transaction_id uuid not null, amount_cents bigint not null check(amount_cents>0), paid_on date not null, foreign key(user_id,invoice_id) references public.invoices(user_id,id), foreign key(user_id,transaction_id) references public.transactions(user_id,id));
create table public.investments (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, name text not null, institution text, value_cents bigint not null check(value_cents>=0), as_of date not null, notes text);
create table public.savings_goals (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, name text not null, target_cents bigint not null check(target_cents>0), target_date date, unique(user_id,id));
create table public.goal_contributions (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, goal_id uuid not null, amount_cents bigint not null check(amount_cents<>0), contributed_on date not null, notes text, foreign key(user_id,goal_id) references public.savings_goals(user_id,id) on delete cascade);

do $$ declare t text; begin
  foreach t in array array['accounts','cards','categories','import_batches','recurring_rules','transactions','invoices','invoice_payments','investments','savings_goals','goal_contributions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_access on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',t);
    execute format('grant select, insert, update, delete on public.%I to authenticated',t);
    execute format('revoke all on public.%I from anon',t);
  end loop;
end $$;
-- Payment rows and settlement transactions may only be created through the atomic RPC.
revoke insert, update, delete on public.invoice_payments from authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('avatars','avatars',false,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy avatar_select on storage.objects for select to authenticated using (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatar_insert on storage.objects for insert to authenticated with check (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatar_update on storage.objects for update to authenticated using (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text) with check (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatar_delete on storage.objects for delete to authenticated using (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- Monthly dashboard excludes settlement transfers from income/expense, avoiding counting card purchases twice.
create function public.monthly_dashboard(p_month date) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('income_cents',coalesce(sum(amount_cents) filter(where amount_cents>0 and source<>'settlement'),0), 'expense_cents',coalesce(-sum(amount_cents) filter(where amount_cents<0 and source<>'settlement'),0), 'net_cents',coalesce(sum(amount_cents) filter(where source<>'settlement'),0), 'count',count(*) filter(where source<>'settlement')) from public.transactions where user_id=(select auth.uid()) and status='confirmed' and occurred_on>=date_trunc('month',p_month)::date and occurred_on<(date_trunc('month',p_month)+interval '1 month')::date;
$$;
revoke all on function public.monthly_dashboard(date) from public, anon;
grant execute on function public.monthly_dashboard(date) to authenticated;

alter table public.transactions add column kind text not null default 'uncategorized' check(kind in ('income','expense','transfer','card_payment','investment','saving','refund','uncategorized')), add column category text not null default 'Sem categoria', add column invoice_month date, add column allocated_amount_cents bigint;
alter table public.transactions add constraint invoice_month_is_first check (invoice_month is null or invoice_month=date_trunc('month',invoice_month)::date);
alter table public.investments add column contributed_cents bigint not null default 0;
alter table public.recurring_rules add column kind text not null default 'expense', add column category text not null default 'Sem categoria';
create table public.profiles (user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade, name text not null default '', avatar_path text);
create table public.monthly_goals (user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, month date not null, amount_cents bigint not null check(amount_cents>=0), primary key(user_id,month));
alter table public.profiles enable row level security;
alter table public.monthly_goals enable row level security;
create policy owner_access on public.profiles for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy owner_access on public.monthly_goals for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.profiles,public.monthly_goals to authenticated;
create policy no_settlement_insert on public.transactions as restrictive for insert to authenticated with check (source <> 'settlement');
create policy no_settlement_update on public.transactions as restrictive for update to authenticated using (source <> 'settlement') with check (source <> 'settlement');
create policy no_settlement_delete on public.transactions as restrictive for delete to authenticated using (source <> 'settlement');

create function public.import_transactions(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); b uuid; r jsonb; a uuid := nullif(p_payload->>'accountId','')::uuid; c uuid := nullif(p_payload->>'cardId','')::uuid; ext text; n int := 0; linked int := 0; skipped int := 0; review_status text; d date; amt bigint;
begin
 if uid is null or num_nonnulls(a,c)<>1 or jsonb_typeof(p_payload->'rows')<>'array' then raise exception 'Invalid import'; end if;
 insert into public.import_batches(user_id,account_id,card_id,file_hash,filename,coverage_start,coverage_end) values(uid,a,c,p_payload->>'fileHash',coalesce(p_payload->>'filename','arquivo'),nullif(p_payload->>'from','')::date,nullif(p_payload->>'to','')::date) on conflict do nothing returning id into b;
 if b is null then return jsonb_build_object('inserted',0,'linked',0,'skipped',jsonb_array_length(p_payload->'rows')); end if;
 for r in select value from jsonb_array_elements(p_payload->'rows') loop
  ext := nullif(r->>'externalId',''); d := (r->>'date')::date; amt := (r->>'amount')::bigint;
  if ext is not null and exists(select 1 from public.transactions t where t.user_id=uid and t.account_id is not distinct from a and t.card_id is not distinct from c and t.external_id=ext) then skipped:=skipped+1; continue; end if;
  if nullif(r->>'matchId','') is not null then
   update public.transactions set import_batch_id=b, source_row=n+linked+skipped+1, external_id=ext, status='confirmed', invoice_month=coalesce(nullif(p_payload->>'month','')::date,invoice_month) where id=(r->>'matchId')::uuid and user_id=uid and account_id is not distinct from a and card_id is not distinct from c and amount_cents=amt and import_batch_id is null and (c is null or (nullif(p_payload->>'month','') is not null and coalesce(invoice_month,date_trunc('month',occurred_on)::date)=date_trunc('month',(p_payload->>'month')::date)::date));
   if not found then raise exception 'Invalid import match'; end if;
   linked:=linked+1; continue;
  end if;
  -- Ambiguous matches are explicitly resolved in the import preview before submission.
  review_status := 'confirmed';
  insert into public.transactions(user_id,account_id,card_id,occurred_on,description,amount_cents,kind,category,status,source,import_batch_id,source_row,external_id,installment_number,installment_count,invoice_month) values(uid,a,c,d,r->>'description',amt,r->>'kind',coalesce(nullif(r->>'category',''),'Sem categoria'),review_status,case when c is not null then 'invoice' when ext is null then 'csv' else 'ofx' end,b,n+linked+skipped+1,ext,nullif(r->>'installmentNumber','')::int,nullif(r->>'installmentCount','')::int,nullif(p_payload->>'month','')::date);
  n:=n+1;
 end loop;
 return jsonb_build_object('inserted',n,'linked',linked,'skipped',skipped);
end $$;
revoke all on function public.import_transactions(jsonb) from public,anon;
grant execute on function public.import_transactions(jsonb) to authenticated;

create function public.add_installments(p_card uuid,p_description text,p_category text,p_total bigint,p_count int,p_first date) returns void language plpgsql security invoker set search_path='' as $$
declare i int; cents bigint; grp uuid:=gen_random_uuid(); d date; invoice_date date; due int;
begin
 if auth.uid() is null or p_count<1 or p_count>360 or p_total>=0 or p_first is null then raise exception 'Invalid installments'; end if;
 select due_day into due from public.cards where id=p_card and user_id=auth.uid();
 if not found then raise exception 'Card not found'; end if;
 for i in 0..p_count-1 loop
  cents := (abs(p_total)/p_count + case when i < abs(p_total)%p_count then 1 else 0 end) * case when p_total<0 then -1 else 1 end;
  if cents=0 then raise exception 'Installment cannot be zero'; end if;
  invoice_date := (date_trunc('month',p_first) + make_interval(months=>i))::date;
  d := invoice_date + least(due,extract(day from (invoice_date + interval '1 month - 1 day'))::int) - 1;
  insert into public.transactions(card_id,occurred_on,description,amount_cents,kind,category,status,source,installment_group_id,installment_number,installment_count,invoice_month) values(p_card,d,p_description,cents,'expense',p_category,'planned','installment',grp,i+1,p_count,invoice_date);
 end loop;
end $$;
revoke all on function public.add_installments(uuid,text,text,bigint,int,date) from public,anon;
grant execute on function public.add_installments(uuid,text,text,bigint,int,date) to authenticated;
create function public.settle_invoice(p_payment_id uuid,p_card_id uuid,p_month date,p_amount bigint) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); payment public.transactions%rowtype; inv public.invoices%rowtype; total bigint; paid bigint; already_allocated bigint;
begin
 if uid is null or p_amount is null or p_amount<=0 or p_month is null then raise exception 'Invalid settlement'; end if;
 select * into payment from public.transactions where id=p_payment_id and user_id=uid for update;
 if not found or payment.account_id is null or payment.status<>'confirmed' or payment.amount_cents>=0 or payment.kind not in ('card_payment','uncategorized') then raise exception 'Invalid payment'; end if;
 if not exists(select 1 from public.cards where id=p_card_id and user_id=uid) then raise exception 'Card not found'; end if;
 p_month:=date_trunc('month',p_month)::date;
 select coalesce(-sum(amount_cents),0) into total from public.transactions where user_id=uid and card_id=p_card_id and coalesce(invoice_month,date_trunc('month',occurred_on)::date)=p_month and status<>'review' and kind in ('expense','refund');
 if total<=0 then raise exception 'Invoice has no balance'; end if;
 insert into public.invoices(user_id,card_id,month,amount_cents) values(uid,p_card_id,p_month,total) on conflict(user_id,card_id,month) do nothing;
 select * into inv from public.invoices where user_id=uid and card_id=p_card_id and month=p_month for update;
 select coalesce(sum(amount_cents),0) into paid from public.invoice_payments where user_id=uid and invoice_id=inv.id;
 if p_amount>total-paid then raise exception 'Payment exceeds remaining invoice balance'; end if;
 select coalesce(sum(amount_cents),0) into already_allocated from public.invoice_payments where user_id=uid and transaction_id=payment.id;
 if p_amount > -payment.amount_cents-already_allocated then raise exception 'Payment allocation exceeds remaining amount'; end if;
 update public.invoices set amount_cents=total where id=inv.id;
 insert into public.invoice_payments(user_id,invoice_id,transaction_id,amount_cents,paid_on) values(uid,inv.id,payment.id,p_amount,payment.occurred_on);
 update public.transactions set kind='card_payment',allocated_amount_cents=already_allocated+p_amount where id=payment.id;
end $$;
revoke all on function public.settle_invoice(uuid,uuid,date,bigint) from public,anon;
grant execute on function public.settle_invoice(uuid,uuid,date,bigint) to authenticated;
alter table public.recurring_rules drop constraint recurring_rules_check;
create function public.save_recurrence(p_data jsonb,p_effective date default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); old public.recurring_rules%rowtype; result uuid; effective date;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if nullif(p_data->>'id','') is not null then
  select * into old from public.recurring_rules where id=(p_data->>'id')::uuid and user_id=uid for update;
  if not found then raise exception 'Recurrence not found'; end if;
  effective:=greatest(date_trunc('month',coalesce(p_effective,current_date))::date,date_trunc('month',old.starts_on)::date);
  if effective<=date_trunc('month',old.starts_on)::date then
   update public.recurring_rules set description=p_data->>'description',amount_cents=(p_data->>'amount')::bigint,kind=p_data->>'kind',category=p_data->>'category',day_of_month=(p_data->>'day')::int,starts_on=(p_data->>'startMonth')::date,ends_on=nullif(p_data->>'endMonth','')::date where id=old.id returning id into result;
   return result;
  end if;
  update public.recurring_rules set ends_on=(effective-interval '1 day')::date where id=old.id;
 else effective := (p_data->>'startMonth')::date;
 end if;
 insert into public.recurring_rules(description,amount_cents,kind,category,day_of_month,starts_on,ends_on) values(p_data->>'description',(p_data->>'amount')::bigint,p_data->>'kind',p_data->>'category',(p_data->>'day')::int,effective,nullif(p_data->>'endMonth','')::date) returning id into result;
 return result;
end $$;
revoke all on function public.save_recurrence(jsonb,date) from public,anon;
grant execute on function public.save_recurrence(jsonb,date) to authenticated;
create or replace function public.monthly_dashboard(p_month date) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'profile',coalesce((select jsonb_agg(x) from public.profiles x),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(x) from public.accounts x),'[]'::jsonb),
  'cards',coalesce((select jsonb_agg(x) from public.cards x),'[]'::jsonb),
  'investments',coalesce((select jsonb_agg(x) from public.investments x),'[]'::jsonb),
  'goals',coalesce((select jsonb_agg(x) from public.monthly_goals x where month=date_trunc('month',p_month)::date),'[]'::jsonb),
  'batches',coalesce((select jsonb_agg(x) from public.import_batches x where coverage_start < (date_trunc('month',p_month)+interval '1 month')::date and coverage_end>=date_trunc('month',p_month)::date),'[]'::jsonb),
  'rules',coalesce((select jsonb_agg(x) from public.recurring_rules x where starts_on<(date_trunc('month',p_month)+interval '1 month')::date and (ends_on is null or ends_on>=date_trunc('month',p_month)::date)),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(x order by x.occurred_on desc,x.id desc) from public.transactions x where x.occurred_on>=date_trunc('month',p_month)::date and x.occurred_on<(date_trunc('month',p_month)+interval '1 month')::date and x.status<>'review'),'[]'::jsonb),
  'invoice_rows',coalesce((select jsonb_agg(x) from public.transactions x where x.card_id is not null and x.status<>'review' and ((x.invoice_month=date_trunc('month',p_month)::date) or (x.invoice_month is null and x.occurred_on>=date_trunc('month',p_month)::date and x.occurred_on<(date_trunc('month',p_month)+interval '1 month')::date))),'[]'::jsonb),
  'trend',coalesce((select jsonb_agg(t order by t.month) from (select to_char(occurred_on,'YYYY-MM') as month,coalesce(sum(amount_cents) filter(where kind='income'),0) as income,coalesce(-sum(amount_cents) filter(where kind in ('expense','refund')),0) as expenses from public.transactions where status='confirmed' and occurred_on>=(date_trunc('month',p_month)-interval '5 months')::date and occurred_on<(date_trunc('month',p_month)+interval '1 month')::date group by to_char(occurred_on,'YYYY-MM')) t),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(x) from public.invoices x where month=date_trunc('month',p_month)::date),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(p) from public.invoice_payments p join public.invoices i on i.id=p.invoice_id and i.user_id=p.user_id where i.month=date_trunc('month',p_month)::date),'[]'::jsonb));
$$;
create index transactions_card_invoice on public.transactions(user_id,card_id,invoice_month,occurred_on);
create index import_coverage on public.import_batches(user_id,coverage_start,coverage_end);
create unique index transactions_recurring_period on public.transactions(user_id,recurring_rule_id,(date_trunc('month',occurred_on::timestamp))) where recurring_rule_id is not null;
create policy protect_allocated_payment_update on public.transactions as restrictive for update to authenticated using (not exists(select 1 from public.invoice_payments p where p.transaction_id=transactions.id and p.user_id=(select auth.uid()))) with check (not exists(select 1 from public.invoice_payments p where p.transaction_id=transactions.id and p.user_id=(select auth.uid())));
create policy protect_allocated_payment_delete on public.transactions as restrictive for delete to authenticated using (not exists(select 1 from public.invoice_payments p where p.transaction_id=transactions.id and p.user_id=(select auth.uid())));
-- Allocations are server-maintained; clients cannot forge them through the Data API.
revoke insert, update on public.transactions from authenticated;
grant insert (id,user_id,account_id,card_id,category_id,occurred_on,description,amount_cents,status,source,import_batch_id,source_row,external_id,recurring_rule_id,installment_group_id,installment_number,installment_count,notes,created_at,kind,category,invoice_month) on public.transactions to authenticated;
grant update (account_id,card_id,category_id,occurred_on,description,amount_cents,status,source,import_batch_id,source_row,external_id,recurring_rule_id,installment_group_id,installment_number,installment_count,notes,kind,category,invoice_month) on public.transactions to authenticated;
