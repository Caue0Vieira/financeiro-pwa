-- Resumo mensal: no dia 1 o Worker gera o resumo do mês anterior de cada usuário. Os números são
-- calculados em código (src/summary.ts) a partir dos totais abaixo; o Workers AI só escreve o
-- comentário, sem números. O dono lê os resumos e só pode dispensar o cartão do painel.

create table public.monthly_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  numbers jsonb not null check (jsonb_typeof(numbers) = 'object'),
  text text not null check (length(text) between 1 and 1500),
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (user_id, month)
);
alter table public.monthly_summaries enable row level security;
create policy owner_read on public.monthly_summaries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy owner_dismiss on public.monthly_summaries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.monthly_summaries from public, anon, authenticated;
grant select on public.monthly_summaries to authenticated;
grant update (dismissed_at) on public.monthly_summaries to authenticated;

-- Totais do mês (mesmas regras da tendência do painel: confirmados, por data) para quem teve
-- lançamentos e ainda não tem resumo. p_users null = todos (cron); só o Worker executa.
create function public.monthly_summary_inputs(p_month date, p_users uuid[] default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select date_trunc('month', p_month)::date as start,
           (date_trunc('month', p_month) + interval '1 month')::date as finish,
           (date_trunc('month', p_month) - interval '1 month')::date as before
  ), people as (
    select distinct t.user_id
    from public.transactions t, bounds b
    where t.status = 'confirmed' and t.occurred_on >= b.start and t.occurred_on < b.finish
      and (p_users is null or t.user_id = any(p_users))
      and not exists (select 1 from public.monthly_summaries s where s.user_id = t.user_id and s.month = b.start)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id,
    'income', (select coalesce(sum(t.amount_cents), 0) from public.transactions t
               where t.user_id = p.user_id and t.status = 'confirmed' and t.kind = 'income'
                 and t.occurred_on >= b.start and t.occurred_on < b.finish),
    'expenses', (select coalesce(-sum(t.amount_cents), 0) from public.transactions t
                 where t.user_id = p.user_id and t.status = 'confirmed' and t.kind in ('expense', 'refund')
                   and t.occurred_on >= b.start and t.occurred_on < b.finish),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'amount', c.amount)), '[]'::jsonb)
                   from (select t.category, -sum(t.amount_cents) as amount from public.transactions t
                         where t.user_id = p.user_id and t.status = 'confirmed' and t.kind in ('expense', 'refund')
                           and t.occurred_on >= b.start and t.occurred_on < b.finish
                         group by t.category) c),
    'previous', (select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'amount', c.amount)), '[]'::jsonb)
                 from (select t.category, -sum(t.amount_cents) as amount from public.transactions t
                       where t.user_id = p.user_id and t.status = 'confirmed' and t.kind in ('expense', 'refund')
                         and t.occurred_on >= b.before and t.occurred_on < b.start
                       group by t.category) c),
    'goal', (select coalesce(max(g.amount_cents), 0) from public.monthly_goals g where g.user_id = p.user_id and g.month = b.start),
    'largest', (select jsonb_build_object('description', t.description, 'amount', -t.amount_cents, 'date', t.occurred_on)
                from public.transactions t
                where t.user_id = p.user_id and t.status = 'confirmed' and t.kind = 'expense'
                  and t.occurred_on >= b.start and t.occurred_on < b.finish
                order by t.amount_cents, t.occurred_on limit 1)
  )), '[]'::jsonb)
  from people p, bounds b;
$$;
revoke all on function public.monthly_summary_inputs(date, uuid[]) from public, anon, authenticated;
grant execute on function public.monthly_summary_inputs(date, uuid[]) to service_role;
