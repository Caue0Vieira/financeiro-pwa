# Supabase local e produção

A configuração local desabilita cadastro e acesso anônimo. Instale o Supabase CLI, inicie uma pilha local isolada e aplique a migração. Crie o usuário autorizado por um processo administrativo fora do aplicativo.

No projeto hospedado, desabilite novas inscrições e acesso anônimo nas configurações de Auth, mantenha autenticação por e-mail e senha e crie apenas o usuário autorizado administrativamente. A configuração local não altera o projeto hospedado. Use no frontend apenas a URL e a chave publicável; nunca uma chave secret/service role. O bucket de avatar é privado e os objetos devem permanecer sob o prefixo do ID do usuário.

Execute `node supabase/test.mjs` para uma verificação local com PGlite e dados fictícios. Esse teste simula os esquemas de Auth e Storage; ele não substitui aplicar e validar a migração em uma pilha Supabase local real e executar os advisors antes de produção. A migração foi criada manualmente porque o CLI não estava disponível no ambiente.
