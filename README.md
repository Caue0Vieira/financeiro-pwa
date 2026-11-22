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

### Open Finance (Pluggy)

O Worker em [src/worker](src/worker) responde só às rotas `/api/*` e guarda as credenciais da Pluggy e a chave `service_role` do Supabase como segredos da Cloudflare. O navegador chama essas rotas com o token da sessão e nunca recebe as credenciais. As compras novas chegam pelo webhook e pelo botão **Sincronizar** na tela **Open Finance**; o passo a passo do Meu Pluggy está em **Perfil → Ajuda e suporte**.

1. Aplique a migração [20261118230000_pluggy.sql](supabase/migrations/20261118230000_pluggy.sql) no SQL Editor do Supabase.
2. Publique com `npx cf deploy` e cadastre cada segredo com o comando abaixo, colando o valor quando o terminal pedir. Não salve esses valores em arquivos do projeto.

```sh
npx cf workers secrets update SUPABASE_URL --worker financeiro-pwa
npx cf workers secrets update SUPABASE_SERVICE_ROLE_KEY --worker financeiro-pwa
npx cf workers secrets update PLUGGY_CLIENT_ID --worker financeiro-pwa
npx cf workers secrets update PLUGGY_CLIENT_SECRET --worker financeiro-pwa
npx cf workers secrets update PLUGGY_WEBHOOK_SECRET --worker financeiro-pwa
```

- `SUPABASE_URL`: a mesma URL do projeto. `SUPABASE_SERVICE_ROLE_KEY`: em **Project Settings → API Keys** (chave secreta; ignora o RLS, por isso fica só no Worker).
- `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`: em **Applications** no painel da Pluggy.
- `PLUGGY_WEBHOOK_SECRET`: um token aleatório de 64 caracteres. No painel da Pluggy, crie o webhook com a URL `https://<seu-worker>/api/pluggy/webhook` e o evento `all`, e em **Headers personalizados** adicione `X-Webhook-Token` com esse mesmo token. Se a sua conta tiver **Generate signing secret**, o valor `whsec_…` também funciona, sem header. O Worker recusa notificações sem um dos dois. Para gerar o token já copiado para a área de transferência:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (($b | ForEach-Object { $_.ToString('x2') }) -join '') | Set-Clipboard
```

#### Uma aplicação da Pluggy por usuário

O Meu Pluggy só aceita as contas do titular, então cada pessoa com conta no app precisa da própria aplicação da Pluggy (grátis em [dashboard.pluggy.ai](https://dashboard.pluggy.ai)). Ela cola o Client ID e o Client Secret em **Open Finance → Sua aplicação da Pluggy**. O Worker confere as credenciais com a Pluggy, cria nessa aplicação o webhook (evento `all`, header `X-Webhook-Token` com um token novo) e guarda o segredo cifrado com AES-GCM na tabela `pluggy_credentials`, que o navegador não acessa. O token do webhook fica só como hash. Quem não cadastrar uma aplicação continua usando a do servidor (`PLUGGY_CLIENT_ID`), e as conexões antigas seguem nela (`pluggy_items.own_app = false`).

1. Aplique a migração [20261122120000_pluggy_own_app.sql](supabase/migrations/20261122120000_pluggy_own_app.sql).
2. Cadastre o segredo `PLUGGY_CREDENTIALS_KEY`, com 32 bytes aleatórios em hex (o mesmo comando do token acima gera um valor válido). Trocar essa chave invalida as aplicações já salvas: cada pessoa precisa cadastrar a dela de novo.

```sh
npx cf workers secrets update PLUGGY_CREDENTIALS_KEY --worker financeiro-pwa
```

Para trocar de aplicação ou removê-la, desconecte antes os bancos feitos com ela. O cron continua sincronizando uma conexão por vez, de qualquer usuário. Com mais conexões, cada uma demora mais para ser sincronizada pelo backup, mas o webhook continua chegando na hora.

No iPhone, abra o endereço publicado no Safari. Toque em **Compartilhar → Adicionar à Tela de Início** e ative **Abrir como App da Web** quando essa opção aparecer.

### Notificações push

O Worker envia avisos por Web Push (VAPID): conta vencendo amanhã, fatura fechando em 2 dias, gasto alto que chegou pela Pluggy e categoria (ou o mês) que passou de 80% e de 100% do limite. Cada aparelho ativa em **Perfil → Notificações** e escolhe os avisos. No iPhone e no iPad, o push só funciona com o app instalado na tela de início.

1. Aplique a migração [20261121130000_push_notifications.sql](supabase/migrations/20261121130000_push_notifications.sql) no SQL Editor do Supabase. Ela cria as inscrições, o registro do que já foi avisado e os limites por categoria (editados em **Orçamento → Limites por categoria**).
2. Gere o par de chaves com `node scripts/vapid-keys.mjs` e cadastre os dois valores como segredos, colando cada um quando o terminal pedir. A chave pública não é secreta (o app a lê em `/api/push/key`), mas fica junto da privada para as duas não se separarem. Trocar as chaves invalida as inscrições: cada aparelho precisa ativar de novo.

```sh
npx cf workers secrets update VAPID_PUBLIC_KEY --worker financeiro-pwa
npx cf workers secrets update VAPID_PRIVATE_KEY --worker financeiro-pwa
```

O cron de hora em hora reveza o trabalho por causa do limite de 50 subrequisições do plano gratuito: nas horas pares (horário de Brasília) faz o backup do webhook da Pluggy e nas ímpares envia os avisos, entre 7h e 22h. Sem nenhum aparelho inscrito, o sync roda em todas as horas. O gasto alto também é avisado logo depois do webhook da Pluggy.

### Resumo mensal

No dia 1, a partir das 9h, o cron gera o resumo do mês anterior de cada usuário com lançamentos (com os dias 2 e 3 de reserva, se algo falhar): entradas, saídas, saldo, as 3 categorias que mais cresceram, a meta de economia do mês (definida pelo cartão do resumo) e o maior gasto. Os números vêm de [src/summary.ts](src/summary.ts); o Workers AI só escreve um comentário curto e, se a resposta trouxer qualquer número, o app usa um texto próprio. O resumo aparece como cartão no painel, fica no histórico em **Orçamento e Análise → Análise** e chega como push. Aplique a migração [20261121140000_monthly_summaries.sql](supabase/migrations/20261121140000_monthly_summaries.sql); não há segredo novo.

### Assinaturas

A tela **Assinaturas** (em **Mais**) encontra cobranças recorrentes nos últimos 13 meses ([src/subscriptions.ts](src/subscriptions.ts)): o mesmo estabelecimento (descrição normalizada, sem códigos como `PG *`), com valor parecido (±15% de uma cobrança para a seguinte) e intervalo mensal ou anual. Mostra o custo por mês e por ano, marca as novas e as que ficaram mais caras e manda push nesses casos. Cada escolha ("É assinatura" ou "Ignorar") fica guardada por estabelecimento e vale para as próximas detecções. Aplique a migração [20261121160000_subscription_detector.sql](supabase/migrations/20261121160000_subscription_detector.sql).

### Lançamento rápido

No chat do assistente, frases como "gastei 45 no ifood ontem no nubank", "paguei 23,90 de uber no pix", "recebi 300 de freela" ou "comprei uma TV de 3 mil em 10x no inter" viram um cartão de cadastro para conferir e confirmar. O app entende valor, data (hoje, ontem, dia 12, 12/11, "na sexta"), cartão ou conta e estabelecimento sozinho, sem a IA ([parseQuickEntry](src/frontend/assistantActions.ts)), então funciona também na demonstração; frases fora desse padrão seguem para a IA, que pode propor o mesmo cadastro. No app instalado, segure o ícone e toque em **Novo gasto** para abrir o lançamento direto.

### Exportar dados

Em **Perfil → Exportar dados**: a planilha CSV de qualquer período (data, descrição, valor, tipo, categoria, situação, conta ou cartão, fatura, parcela e tags; separada por `;`, com vírgula decimal, abre direto no Excel em português) e o extrato de um mês em PDF, com totais, gastos por categoria e todos os lançamentos. Os dois arquivos são gerados no aparelho ([src/frontend/exports.ts](src/frontend/exports.ts) e um gerador de PDF mínimo em [src/frontend/pdf.ts](src/frontend/pdf.ts)), sem biblioteca nem servidor.

### Comprovantes

Ao abrir um lançamento salvo, a seção **Comprovantes** anexa fotos ou PDFs. A foto é reduzida no aparelho antes do envio (até 1600 px, JPEG, com uma miniatura de 320 px) e o PDF vai como está, até 5 MB. Os arquivos ficam no bucket privado `receipts` do Supabase Storage, sob o prefixo do `user_id` (como o avatar), e saem junto quando o lançamento é excluído. Aplique a migração [20261121170000_receipts.sql](supabase/migrations/20261121170000_receipts.sql); ela cria o bucket e as políticas.

### Tags e busca avançada

Cada lançamento aceita até 10 tags livres (campo **Tags** no editor; ficam em minúsculas, sem `#`). Em **Transações → Buscar**, o texto procura na descrição, na categoria e nas tags; em **Filtros** dá para combinar faixa de valor (sem importar o sinal), período, conta ou cartão, categoria e tag, e **Buscar em todos os meses** traz até 200 resultados com o total. **Análise** mostra os gastos por tag no período. Aplique a migração [20261121180000_tags.sql](supabase/migrations/20261121180000_tags.sql).

## Arquivos de importação

- Para o extrato da conta, selecione o CSV do Inter ou um OFX bancário. Revise períodos, tipos, categorias e possíveis duplicatas.
- Para a fatura CSV, selecione o apelido do cartão, o mês com vencimento e o mapeamento das colunas. Revise os vínculos sugeridos com parcelas existentes.
- Cadastre cartões em **Cartões**, com um banco ou como avulsos. Em **Contas a pagar → Faturas do cartão → Vincular pagamento**, associe os pagamentos do extrato. O indicador **A pagar** acompanha o saldo restante.

O arquivo original é lido no navegador. Após você confirmar, só os lançamentos revisados e os metadados necessários à deduplicação e cobertura são enviados ao Supabase.

## Validação

`npm test` executa testes do leitor CSV/OFX e da migração com papéis simulados de Supabase no Postgres do PGlite. Antes de usar dados pessoais, valide login, avatar, isolamento e advisors no projeto hospedado. Para medir a meta de 500 ms, use o menu **Perfil → Medir API do painel** no iPhone conectado, uma vez em Wi‑Fi e outra em 4G, e compare o p95 reportado.
