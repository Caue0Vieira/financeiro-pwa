create schema finance_private;
revoke all on schema finance_private from public, anon;
grant usage on schema finance_private to authenticated;

alter function public.settle_invoice(uuid, uuid, date, bigint)
  set schema finance_private;

create function public.settle_invoice(p_payment_id uuid, p_card_id uuid, p_month date, p_amount bigint)
returns void
language sql volatile security invoker
set search_path = ''
as $$
  select finance_private.settle_invoice(p_payment_id, p_card_id, p_month, p_amount);
$$;

revoke all on function public.settle_invoice(uuid, uuid, date, bigint) from public, anon;
grant execute on function public.settle_invoice(uuid, uuid, date, bigint) to authenticated;

create index goal_contributions_owner_goal on public.goal_contributions(user_id, goal_id);
create index investments_owner on public.investments(user_id);
create index invoice_payments_owner_invoice on public.invoice_payments(user_id, invoice_id);
create index invoice_payments_owner_transaction on public.invoice_payments(user_id, transaction_id);
create index recurring_rules_owner_account on public.recurring_rules(user_id, account_id);
create index recurring_rules_owner_card on public.recurring_rules(user_id, card_id);
create index recurring_rules_owner_category on public.recurring_rules(user_id, category_id);
create index transactions_owner_batch on public.transactions(user_id, import_batch_id);

create or replace function public.import_transactions(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); b uuid; r jsonb; a uuid := nullif(p_payload->>'accountId','')::uuid; c uuid := nullif(p_payload->>'cardId','')::uuid; ext text; n int := 0; linked int := 0; skipped int := 0; review_status text; d date; amt bigint;
begin
 if uid is null or num_nonnulls(a,c)<>1 or jsonb_typeof(p_payload->'rows')<>'array' then raise exception 'Invalid import'; end if;
 insert into public.import_batches(user_id,account_id,card_id,file_hash,filename,coverage_start,coverage_end) values(uid,a,c,p_payload->>'fileHash',coalesce(p_payload->>'filename','arquivo'),nullif(p_payload->>'from','')::date,nullif(p_payload->>'to','')::date) on conflict do nothing returning id into b;
 if b is null then return jsonb_build_object('inserted',0,'linked',0,'skipped',jsonb_array_length(p_payload->'rows')); end if;
 for r in select value from jsonb_array_elements(p_payload->'rows') loop
  ext := nullif(r->>'externalId',''); d := (r->>'date')::date; amt := (r->>'amount')::bigint;
  if ext is not null and exists(select 1 from public.transactions t where t.user_id=uid and t.account_id is not distinct from a and t.card_id is not distinct from c and t.external_id=ext) then skipped:=skipped+1; continue; end if;
  if nullif(r->>'matchId','') is not null then
   update public.transactions set import_batch_id=b, source_row=n+linked+skipped+1, external_id=ext, status='confirmed', invoice_month=coalesce(date_trunc('month',nullif(p_payload->>'month','')::date)::date,invoice_month) where id=(r->>'matchId')::uuid and user_id=uid and account_id is not distinct from a and card_id is not distinct from c and amount_cents=amt and import_batch_id is null and (c is null or (nullif(p_payload->>'month','') is not null and coalesce(invoice_month,date_trunc('month',occurred_on)::date)=date_trunc('month',(p_payload->>'month')::date)::date));
   if not found then raise exception 'Invalid import match'; end if;
   linked:=linked+1; continue;
  end if;
  -- Ambiguous matches are explicitly resolved in the import preview before submission.
  review_status := 'confirmed';
  insert into public.transactions(user_id,account_id,card_id,occurred_on,description,amount_cents,kind,category,status,source,import_batch_id,source_row,external_id,installment_number,installment_count,invoice_month) values(uid,a,c,d,r->>'description',amt,r->>'kind',coalesce(nullif(r->>'category',''),'Sem categoria'),review_status,case when c is not null then 'invoice' when ext is null then 'csv' else 'ofx' end,b,n+linked+skipped+1,ext,nullif(r->>'installmentNumber','')::int,nullif(r->>'installmentCount','')::int,date_trunc('month',nullif(p_payload->>'month','')::date)::date) on conflict do nothing;
  if found then n:=n+1; else skipped:=skipped+1; end if;
 end loop;
 return jsonb_build_object('inserted',n,'linked',linked,'skipped',skipped);
end $$;
