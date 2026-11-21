-- Assinaturas canceladas: o usuário marca "Cancelei" e a assinatura sai do total. A data da
-- decisão (updated_at) diz desde quando; uma cobrança depois dela aparece como alerta no app.
alter table public.subscription_decisions drop constraint subscription_decisions_status_check;
alter table public.subscription_decisions add constraint subscription_decisions_status_check
  check (status in ('confirmed', 'ignored', 'cancelled'));
