# Treinamento do Cris aplicado às duas Lilys

Data: 03/11/2026. Destinos: agentes vinculados às instâncias CLICK e GIGA CLICK.

Fonte: arquivos locais da pasta `../Allfa Fibra `, especialmente `scripts/update-cris.ts`, `scripts/update-cris-flow.mjs` (somente personalidade e regras), orientações comerciais e de interpretação em `src/modules/chatbot/services/chatbot-engine.service.ts` e `src/services/openai/openai.service.ts`, além de `docs/cris-interpretation.md` e `docs/cris-objections.md`.

As conexões ao banco do Alfa não responderam. Portanto, a referência utilizada foi o treinamento registrado no código local; não foi possível comparar com eventual personalização mais recente no banco do Alfa. Nenhum script de atualização do Alfa foi executado. As consultas tentadas foram somente leitura.

## Conteúdo transferido e adaptado

Personalidade comercial do Cris adaptada à identidade feminina da Lily e à Click Hubnet: simpatia, persuasão consultiva, paciência, objetividade, cordialidade, humor leve e comunicação natural.

As 22 diretrizes cobrem memória, dúvidas comerciais, catálogo do próprio agente, cobertura, respeito às etapas existentes, documentos, política/religião, contexto, venda consultiva, emojis, objeções/recusas, pergunta concreta, interpretação, evidência literal, confirmação, espera/retomada, condições comerciais, segurança, identidade, isolamento e silêncio após encerramento.

Orientações antigas para esconder a automação foram alinhadas à instrução do motor atual do próprio Cris: transparência se o cliente perguntar. Não foram importadas alegações de vínculo com a Claro ou condições comerciais específicas do Alfa.

## Preservações

O procedimento escreve exclusivamente `Agent.personality` e `Agent.rules`; `updatedAt` é atualizado automaticamente pelo banco. Nome, gênero, status, modelo de IA, instâncias, credenciais, tempos de resposta, flags de comportamento, planos e vínculos, benefícios, preços e JSON do fluxo são comparados antes/depois e preservados. Conversas, memórias em andamento e leads não são alterados.

As regras de cobertura e de etapas do destino prevalecem sobre a referência para manter a aceitação de CEP e a ordem atual. Metadados e regras próprias existentes também são mantidos. Não foram copiadas tabelas, planos, etapas, mensagens do funil, modelos de integração, classificador de estados, follow-up automático ou código do motor do Alfa.

O motor, o interpretador e os prompts fixos do CLICKHUB não foram reescritos. As regras são utilizadas pelos pontos já existentes que carregam `agent.personality`/`agent.rules`. Isso não altera as mensagens determinísticas do fluxo nem adiciona capacidades que dependam de IA.

Backups locais, excluídos de Git/Vercel: `.backups/cris-training-20261103/`.

## Aplicação e validação

Prévia: `node --env-file=.env --require tsx/cjs scripts/apply-cris-training.ts`.

Aplicar: `node --env-file=.env --require tsx/cjs scripts/apply-cris-training.ts --apply`.

O procedimento usa transação, exige exatamente um agente por instância, guarda backup antes de gravar, verifica concorrência e reverte se qualquer campo protegido mudar. Não envia mensagens.

114 testes automatizados aprovados e TypeScript sem erros. A persistência e as preservações também são conferidas em nova leitura do banco após aplicar.

A configuração é carregada do banco a cada atendimento; não exige mudança de webhook ou republicação do motor.

## Disponibilidade de IA

No momento da verificação, não havia chave OpenAI no banco nem variável `OPENAI_API_KEY` listada na Vercel de produção. Nenhuma chave foi copiada ou ativada. O treinamento está salvo, mas respostas livres, interpretação por modelo, transcrição e leitura por IA dependem de chave válida. O fluxo determinístico continua disponível.
