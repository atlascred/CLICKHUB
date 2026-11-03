# Interface Alfa Fibra adaptada ao CLICKHUB

Referência escolhida pelo usuário: pasta `../Allfa Fibra ` (com espaço no final). Implementação em 03/11/2026, somente no CLICKHUB.

## Abas e comportamento

- Login, fonte Manrope, paleta, cartões, formulários, cabeçalho, temas claro/escuro, menu agrupado/recolhível e navegação móvel do Alfa, mantendo a marca CLICKHUB.
- Dashboard: indicadores, período, gráficos, funil, planos vendidos e últimas oportunidades conforme o Alfa.
- Visão Geral: períodos, indicadores de leads, vendas, conversas, tarefas, despesas, responsáveis e exportação XLSX.
- Conversas: lista paginada, histórico paginado, filtros, pesquisa, responsáveis, etiquetas/colorização, atendimento manual, anexos, áudio e novo contato. Atualização periódica de 15 segundos, como o fallback do Alfa hospedado na Vercel.
- Envio em Massa: texto, legenda e mídia, contatos normalizados sem duplicatas e resultado por contato. A instância deve ser selecionada explicitamente. Até 100 destinatários e arquivos de até 3 MB por lote. Nenhum disparo é iniciado automaticamente.
- Leads: modos e operações da referência, busca, filtros, estágios, edição e exportação. Filtro por CLICK/GIGA usa a relação com a conversa, pois o chatbot atual registra ambas as instâncias com `source=chatbot`.
- Cadastros/Fornecedores: categorias, pesquisa, paginação e permissões. Restrição de leads por agente adaptada a CLICK e GIGA CLICK.
- CEPs e Configurações: apresentação e formulários da referência conectados aos endpoints atuais.
- Compromissos e Despesas: os componentes e fluxos já eram iguais à referência; recebem o novo tema compartilhado.
- N8N: mantido o cadastro e fluxo atuais da Lily, com superfície visual adaptada. O fluxo padrão e a seleção de planos por agente do CLICKHUB foram preservados.
- SDR por Voz continua indicado como “Em breve”, como no Alfa.
- Verificar WhatsApp e Saúde WhatsApp permanecem disponíveis no menu.

## Preservação

O código da pasta Alfa foi utilizado apenas para leitura. Não foram carregados seus arquivos de ambiente, banco, projeto Vercel ou repositório para operações de alteração. Não foram copiados clientes, usuários, arquivos comerciais, senhas ou credenciais do Alfa.

O diretório `src/modules/chatbot`, o repositório do chatbot, todos os serviços de integração, os webhooks, o schema Prisma, os ambientes, os prompts e os cadastros/planos existentes não foram alterados. Não houve migração de banco. Automação, follow-up, motor Z-API e agentes do Alfa não foram importados.

A nova central usa `/api/inbox` e um repositório separado. O envio manual reutiliza o endpoint Evolution do CLICKHUB, que resolve a instância pelo agente da própria conversa. Novos contatos e disparos exigem seleção da instância. Controle manual usa flags reconhecidas pela Lily e atualização atômica da memória; etiquetas não substituem a memória completa. `FINISHED` e bloqueios não são reativados pela devolução ao bot. Entrega incerta impede liberação automática.

Backup da implementação anterior e manifestos SHA-256: `.backups/alfa-ui-20261103/` (local, fora de Git e Vercel).

## Verificação

- 101 regressões do chatbot e 9 testes de adaptação do CRM.
- Build de produção e TypeScript.
- Navegador: 12 páginas em desktop e 6 em celular, sem erros de cliente ou rolagem horizontal da página; menu persistente, temas e filtros por agente verificados. APIs e envio foram simulados; chamadas externas bloqueadas.
- Consultas por instância e operações de responsável/etiquetas verificadas no Supabase do CLICKHUB em transação revertida, incluindo preservação de `FINISHED` e dados da memória.
- Manifestos comprovam que os arquivos protegidos do chatbot e os arquivos de referência do Alfa mantêm os hashes originais.
- Nenhuma mensagem real de WhatsApp enviada durante as validações.

Comandos reproduzíveis: `npm test`, `npm run simulate:chatbot`, `npm run build`.
