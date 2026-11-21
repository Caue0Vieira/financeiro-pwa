-- O RLS já restringe cada linha ao dono, mas algumas tabelas ainda tinham
-- privilégios herdados do padrão do Supabase: tudo para anon em profiles,
-- monthly_goals e category_rules, e TRUNCATE (que ignora o RLS), TRIGGER e
-- REFERENCES para authenticated. Mantém só o que o app usa.

-- Visitantes sem login não acessam nenhuma tabela, sequência ou função do public.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from public, anon;

-- Usuários logados nunca precisam de TRUNCATE, TRIGGER ou REFERENCES.
revoke truncate, trigger, references on all tables in schema public from authenticated;

-- learn_category é função de gatilho; o gatilho continua disparando sem EXECUTE.
revoke all on function public.learn_category() from authenticated;

-- Reaplica os EXECUTE que o app chama (o revoke acima tirou de PUBLIC).
grant execute on function public.monthly_dashboard(date) to authenticated;
grant execute on function public.import_transactions(jsonb) to authenticated;
grant execute on function public.add_installments(uuid, text, text, bigint, int, date) to authenticated;
grant execute on function public.settle_invoice(uuid, uuid, date, bigint) to authenticated;
grant execute on function public.save_recurrence(jsonb, date) to authenticated;
grant execute on function public.save_card(uuid, text, text, int, int) to authenticated;
grant execute on function public.nitido_planning(date) to authenticated;
grant execute on function public.nitido_expense_days(date, date) to authenticated;
grant execute on function public.description_key(text) to authenticated;

-- Objetos criados daqui em diante pelo postgres não nascem abertos para anon
-- nem com TRUNCATE/TRIGGER/REFERENCES para authenticated.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from public, anon;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from authenticated;
