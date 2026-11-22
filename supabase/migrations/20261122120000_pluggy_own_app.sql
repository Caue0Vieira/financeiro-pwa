-- Cada usuário pode usar a própria aplicação da Pluggy (o Meu Pluggy só aceita as contas do
-- titular). Só o Worker (service role) lê e grava as credenciais: o segredo chega cifrado com
-- AES-GCM (chave PLUGGY_CREDENTIALS_KEY, que fica só na Cloudflare) e o token do webhook é
-- guardado apenas como hash SHA-256. O navegador não tem nenhum acesso a esta tabela.
create table public.pluggy_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null,
  client_secret text not null,
  webhook_token_hash text not null unique,
  webhook_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pluggy_credentials enable row level security;
revoke all on public.pluggy_credentials from public, anon, authenticated;

-- Qual aplicação criou a conexão: false = a do servidor (PLUGGY_CLIENT_ID), true = a do dono.
alter table public.pluggy_items add column own_app boolean not null default false;
