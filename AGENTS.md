# Financeiro PWA

Aplicativo pessoal para acompanhar receitas, despesas, faturas, investimentos e metas. A interface usa português do Brasil e valores em reais.

## Produção

- [Abrir o Financeiro publicado](https://financeiro-pwa.cauevieira-dev07.workers.dev/).
- A hospedagem é Cloudflare Workers. O Worker se chama `financeiro-pwa` e sua configuração fica em [`cloudflare.config.ts`](cloudflare.config.ts).
- Quando o usuário pedir o link do app rodando, use a URL de produção acima. Se o endereço mudar, confira **Domains & Routes** no painel do Worker e atualize este arquivo.
- O [`README.md`](README.md) descreve o fluxo de publicação. Para conferir o site que já está no ar, acesse a URL de produção.

## Desenvolvimento

- O frontend usa React, TypeScript e Vite. Use a versão do Node indicada em [`.node-version`](.node-version) e instale as dependências com `npm ci`.
- Rode `npm run dev` para abrir o app localmente. Sem credenciais do Supabase, a demonstração usa dados fictícios e mantém as alterações em memória enquanto a página está aberta.
- Rode `npm test` para os testes de importação, do service worker e do banco com PGlite. Use `npm run build` para validar o TypeScript e gerar o pacote para a Cloudflare.

## Onde editar

- [`src/App.tsx`](src/App.tsx) gerencia sessão, seleção do backend e carregamento do painel. [`src/ui/`](src/ui/) contém as telas e os estilos principais.
- [`src/contracts.ts`](src/contracts.ts) define os contratos usados por [`src/data/demo.ts`](src/data/demo.ts) e [`src/data/supabase.ts`](src/data/supabase.ts).
- [`src/imports/`](src/imports/) contém a leitura e a revisão de extratos CSV e OFX e de faturas CSV. Use dados fictícios ao testar importações.
- [`src/worker/`](src/worker/) é o Worker da Cloudflare que responde só a `/api/*`: integração com a Pluggy (Open Finance) e o webhook, além das cotações da B3 ([`quotes.ts`](src/worker/quotes.ts): brapi com Yahoo como reserva, por cron e por `/api/quotes/refresh`). Os segredos ficam na Cloudflare; veja as seções Open Finance e Cotações do README.
- [`public/`](public/) contém o manifesto, o service worker e a página offline. [`supabase/migrations/`](supabase/migrations/) contém o esquema e as políticas de acesso.
- Consulte [`supabase/README.md`](supabase/README.md) para mudanças em autenticação, migrações ou armazenamento. O frontend usa somente a URL e a chave publicável do Supabase. Mantenha os valores locais em `.env.local`, conforme [`.env.example`](.env.example).

## Git

- Commit e push estão liberados após cada alteração, direto na branch principal (`master`), sem abrir PR.
- Inclua no commit somente os arquivos da alteração feita; não misture outras mudanças pendentes do working tree.
