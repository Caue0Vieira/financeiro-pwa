-- 1. A card charge after the closing day is billed in a later invoice, so the invoice due in a
--    month can hold charges of recurring rules from up to two months before. The dashboard now
--    returns the rules running in that window and which of their charges were already recorded.
create or replace function public.monthly_dashboard(p_month date) returns jsonb language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object(
  'profile',coalesce((select jsonb_agg(x) from public.profiles x),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(x) from public.accounts x),'[]'::jsonb),
  'cards',coalesce((select jsonb_agg(x) from public.cards x),'[]'::jsonb),
  'investments',coalesce((select jsonb_agg(x) from public.investments x),'[]'::jsonb),
  'goals',coalesce((select jsonb_agg(x) from public.monthly_goals x where month=date_trunc('month',p_month)::date),'[]'::jsonb),
  'batches',coalesce((select jsonb_agg(x) from public.import_batches x where coverage_start < (date_trunc('month',p_month)+interval '1 month')::date and coverage_end>=date_trunc('month',p_month)::date),'[]'::jsonb),
  'rules',coalesce((select jsonb_agg(x) from public.recurring_rules x where starts_on<(date_trunc('month',p_month)+interval '1 month')::date and (ends_on is null or ends_on>=(date_trunc('month',p_month)-interval '2 months')::date)),'[]'::jsonb),
  'recurring_rows',coalesce((select jsonb_agg(jsonb_build_object('recurring_rule_id',x.recurring_rule_id,'occurred_on',x.occurred_on)) from public.transactions x where x.recurring_rule_id is not null and x.occurred_on>=(date_trunc('month',p_month)-interval '2 months')::date and x.occurred_on<date_trunc('month',p_month)::date),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(x order by x.occurred_on desc,x.id desc) from public.transactions x where x.occurred_on>=date_trunc('month',p_month)::date and x.occurred_on<(date_trunc('month',p_month)+interval '1 month')::date and x.status<>'review'),'[]'::jsonb),
  'invoice_rows',coalesce((select jsonb_agg(x) from public.transactions x where x.card_id is not null and x.status<>'review' and ((x.invoice_month=date_trunc('month',p_month)::date) or (x.invoice_month is null and x.occurred_on>=date_trunc('month',p_month)::date and x.occurred_on<(date_trunc('month',p_month)+interval '1 month')::date))),'[]'::jsonb),
  'trend',coalesce((select jsonb_agg(t order by t.month) from (select to_char(occurred_on,'YYYY-MM') as month,coalesce(sum(amount_cents) filter(where kind='income'),0) as income,coalesce(-sum(amount_cents) filter(where kind in ('expense','refund')),0) as expenses from public.transactions where status='confirmed' and occurred_on>=(date_trunc('month',p_month)-interval '5 months')::date and occurred_on<(date_trunc('month',p_month)+interval '1 month')::date group by to_char(occurred_on,'YYYY-MM')) t),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(x) from public.invoices x where month=date_trunc('month',p_month)::date),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(p) from public.invoice_payments p join public.invoices i on i.id=p.invoice_id and i.user_id=p.user_id where i.month=date_trunc('month',p_month)::date),'[]'::jsonb));
$$;

-- 2. Deleting (archiving) a card moves the bills and subscriptions charged on it to the account.
--    Months already past stay billed on the card; from the current month on, the account pays.
create or replace function public.move_card_recurrences_to_account() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  this_month date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  update public.recurring_rules set card_id = null
  where user_id = new.user_id and card_id = new.id and starts_on >= this_month;

  insert into public.recurring_rules(user_id, description, amount_cents, kind, category, day_of_month, starts_on, ends_on, account_id, category_id)
  select user_id, description, amount_cents, kind, category, day_of_month, this_month, ends_on, account_id, category_id
  from public.recurring_rules
  where user_id = new.user_id and card_id = new.id and starts_on < this_month and (ends_on is null or ends_on >= this_month);

  update public.recurring_rules set ends_on = this_month - 1
  where user_id = new.user_id and card_id = new.id and starts_on < this_month and (ends_on is null or ends_on >= this_month);
  return new;
end $$;
revoke all on function public.move_card_recurrences_to_account() from public, anon, authenticated;

create trigger cards_archive_moves_recurrences
after update of archived on public.cards
for each row when (new.archived and not old.archived)
execute function public.move_card_recurrences_to_account();
