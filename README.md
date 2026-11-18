# Nítido · Finanças pessoais

Controle pessoal de receitas, despesas, faturas, investimentos e metas, em português e reais.

## Abrir localmente

Use o Node.js indicado em [.node-version](.node-version) ou um patch mais recente da mesma série LTS.

```sh
npm ci
npm test
npm run dev
```

Sem credenciais do Supabase, o servidor de desenvolvimento abre uma demonstração com dados fictícios. A demonstração guarda alterações apenas enquanto a página está aberta. Use **Importar arquivos** para testar extratos localmente e **Perfil** para alternar os temas.

## Estrutura

- [src/frontend](src/frontend) reúne as telas, os componentes, os gráficos e os estilos da interface.
- [src/backend](src/backend) reúne o adaptador do Supabase e a demonstração em memória. O esquema, as regras de acesso e as funções do banco ficam em [supabase/migrations](supabase/migrations).
- [src/App.tsx](src/App.tsx) carrega a sessão e conecta os adaptadores à interface pelos tipos definidos em [src/contracts.ts](src/contracts.ts). A leitura de CSV e OFX fica em [src/imports](src/imports) e roda no navegador.

## Configurar e publicar

1. Use um projeto Supabase Free em São Paulo. Aplique a migração em [supabase/migrations](supabase/migrations) e execute os advisors.
2. Em **Authentication → Sign In / Providers**, desative inscrições e entrada anônima. Em **Authentication → Users**, crie a sua conta com e-mail e senha, e confirme o usuário pelo painel. Digite a senha diretamente no Supabase.
3. Copie [.env.example](.env.example) para `.env.local`. Preencha a URL do projeto e a chave **publishable**. Configure o endereço de produção em **Authentication → URL Configuration → Site URL**.
4. Execute os comandos abaixo. O OAuth é feito no navegador e o frontend usa apenas a chave publicável.

```sh
npm run build
npx cf deploy --dry-run
npx cf auth login
npx cf deploy
```

### Deploy automático

Cada push na `master` dispara o workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que roda os testes, gera o build e publica com `cf deploy`. Ele também pode ser executado manualmente em **Actions → Deploy → Run workflow**. Configure estes segredos no repositório, em **Settings → Secrets and variables → Actions**:

- `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`: os mesmos valores do `.env.production.local`.
- `CLOUDFLARE_API_TOKEN`: token criado no painel da Cloudflare com o modelo **Edit Cloudflare Workers**.
- `CLOUDFLARE_ACCOUNT_ID` (opcional): necessário só se o token tiver acesso a mais de uma conta.

No iPhone, abra o endereço publicado no Safari. Toque em **Compartilhar → Adicionar à Tela de Início** e ative **Abrir como App da Web** quando essa opção aparecer.

## Arquivos de importação

- Para o extrato da conta, selecione o CSV do Inter ou um OFX bancário. Revise períodos, tipos, categorias e possíveis duplicatas.
- Para a fatura CSV, selecione o apelido do cartão, o mês com vencimento e o mapeamento das colunas. Revise os vínculos sugeridos com parcelas existentes.
- Cadastre cartões em **Cartões**, com um banco ou como avulsos. Em **Compromissos → Faturas do mês → Vincular pagamento**, associe os pagamentos do extrato. O indicador **A pagar** acompanha o saldo restante.

O arquivo original é lido no navegador. Após você confirmar, só os lançamentos revisados e os metadados necessários à deduplicação e cobertura são enviados ao Supabase.

## Validação

`npm test` executa testes do leitor CSV/OFX e da migração com papéis simulados de Supabase no Postgres do PGlite. Antes de usar dados pessoais, valide login, avatar, isolamento e advisors no projeto hospedado. Para medir a meta de 500 ms, use o menu **Perfil → Medir API do painel** no iPhone conectado, uma vez em Wi‑Fi e outra em 4G, e compare o p95 reportado.
