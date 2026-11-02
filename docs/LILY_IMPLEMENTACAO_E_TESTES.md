# Lily: implementação, testes e operação

Data: 02/11/2026. Alterações locais; nenhuma publicação, migração ou alteração de dados de produção foi executada nesta tarefa.

## Componentes identificados

O webhook da Evolution recebe e interpreta eventos em `src/app/api/whatsapp/webhook/handler.ts`. O motor `ChatbotEngineService` controla as etapas e respostas. `ChatbotRepository` mantém conversas, mensagens, agentes, planos e leads. `OpenAiService` já concentra chamadas de texto, áudio e documentos, com configuração existente em `src/lib/integration-config.ts`. Esse mecanismo de configuração foi preservado.

A sequência continua sendo: saudação, CEP, número, complemento, planos, escolha, oferta opcional de plano superior, nome, documento, nascimento, e-mail, vencimento, resumo, confirmação, registro e encerramento. Dados antecipados validados podem preencher etapas sem repetir perguntas. A IA não define preços, estados, confirmação, aprovação ou criação de leads.

## Arquivos alterados e motivo

| Arquivo | Mudança |
|---|---|
| `src/modules/chatbot/services/chatbot-engine.service.ts` | Interpretação contextual, dados antecipados, confirmação explícita, validação, mudança de plano, recomendação, tratamento de confusão, controle humano e resposta persistida antes de enviar. |
| `src/repositories/chatbot.repository.ts` | Recibos de resposta, continuidade de atendimento humano/manual, gravação condicional que respeita bloqueio e tomada humana, registro de lead com recibo transacional por evento. |
| `src/services/openai/openai.service.ts` | Interpretação estruturada, evidência literal, contexto recente, limites de tempo, tratamento de indisponibilidade e pontos de injeção para testes. Modelo e configuração existentes mantidos. |
| `src/app/api/whatsapp/webhook/handler.ts` | Agrupamento durável da Evolution, interpretação de imagem/documento, remoção de credenciais do payload armazenado e atualização atômica de presença. |
| `src/app/api/whatsapp/webhook/route.ts` | Limite de execução de 60 segundos para processamento aguardado na própria requisição. |
| `src/app/api/whatsapp/webhook/[...event]/route.ts` | Mesmo limite para a rota de eventos. |
| `src/repositories/settings.repository.ts` | Oculta e protege o namespace operacional `chatbot:` para a fila e recibos não aparecerem como configurações editáveis. |
| `package.json` e `package-lock.json` | Executor TypeScript de desenvolvimento e comandos reproduzíveis de testes/simulação. |
| `tsconfig.json` | Exclui backups e artefatos de teste da compilação. |
| `.env.example` | Documenta a janela opcional de agrupamento. Nenhuma chave real adicionada. |
| `.gitignore` e `.vercelignore` | Excluem backups, relatórios temporários e arquivos de compilação; testes não são enviados ao deploy. |
| `SCRIPT_COMPLETO_CHATBOT_LILY.txt` | Atualiza as condições comerciais oficiais e distingue esta implementação local da versão publicada. |

Arquivos novos:

- `src/modules/chatbot/knowledge.ts`: condições comerciais e explicações técnicas centralizadas.
- `src/modules/chatbot/intelligence.ts`: interpretação validada, dados literais e limites para respostas livres.
- `src/modules/chatbot/services/message-batch.service.ts`: agrupamento, exclusão por conversa, lease e recuperação.
- `src/modules/chatbot/services/incoming-media.service.ts`: adaptação de áudio, imagem e documento com fallback.
- `tests/register.cjs`: isolamento das dependências externas e do banco.
- `tests/chatbot.test.ts`: cenários, repositório/transporte simulados e asserções.
- `scripts/simulate-chatbot.cjs`: executor e geração de evidências.
- Este relatório.

## Backups

Criados com `cp --parents`, antes de alterar os respectivos arquivos, em `.backups/lily-20261101/`, mantendo os caminhos originais. O nome identifica o início da tarefa; a conclusão ocorreu em 02/11.

Contêm os arquivos originais alterados já existentes, inclusive `.gitignore`, `.vercelignore`, `.env.example`, `package.json`, `package-lock.json`, `tsconfig.json`, motor, repositórios, serviço OpenAI, handler, rotas e roteiro. Há também uma cópia preventiva de `src/lib/integration-config.ts`, que permaneceu sem alteração. Arquivos novos não tinham versão anterior para copiar. Nenhum `.env` real foi copiado ou publicado.

## Capacidades implementadas

1. OpenAI interpreta intenção operacional, tom e evidências literais em saída estruturada; conversa sobre assuntos gerais e retorna à pergunta pendente. Não há classificação de intenção de compra nem pontuação de leads.
2. Acolhimento de frustração e desconfiança; apresentação transparente como assistente virtual.
3. Captura antecipada de nome, CEP, documento, nascimento, e-mail, número e complemento com validações do backend. A IA só sugere trechos presentes na mensagem.
4. Recomendação por orçamento/necessidade usando planos ativos; oferta do próximo plano de maior velocidade, com recusa respeitada e sem repetir a oferta recusada.
5. Interpretação de gírias, respostas indiretas e variações pela IA, com regras locais para confirmação, recusa e expressões comuns.
6. Retomada pela etapa persistida, mantendo os dados anteriores.
7. Fallback sem IA, esclarecimento de dados contraditórios, transferência após confusão repetida, erros sem falso sucesso e tratamento de entrega incerta.
8. Áudio, imagens e documentos passam pelo serviço existente quando configurado; conteúdos ilegíveis ou indisponíveis geram pedido de informação digitada.
9. Base oficial: sem pagamento antecipado, instalação gratuita, primeira mensalidade 30 dias após instalação e instalação em até 1 dia útil após aprovação, condicionada à disponibilidade técnica e ao agendamento.
10. Escolhas e confirmações indiretas reconhecidas sem usar uma ocorrência isolada de “sim” ou “correto” dentro de uma frase ambígua como consentimento.
11. Explicações sobre Wi-Fi 5/6, rede móvel 5G e limites de desempenho, sem promessas de cobertura ou equipamento não cadastrado.
12. Mensagens próximas da Evolution agrupadas em uma resposta, preservando os IDs e cada entrada no histórico. O recibo de uma resposta cobre todos os componentes do lote, sem criar mensagens fictícias de saída.
13. Troca de plano durante o cadastro, com nova confirmação se já estiver no resumo.
14. Atendimento humano/manual e bloqueios respeitados, inclusive em uma verificação imediatamente antes do envio.
15. CPF/CNPJ com dígitos verificadores, CEP completo, e-mail, datas reais/não futuras, nome completo, número e vencimento validáveis. Nada é aprovado por preencher um formato.
16. Conhecimento comercial centralizado em código; preços e benefícios continuam exclusivamente no catálogo ativo do banco.
17. Simulador isolado com testes determinísticos para regras críticas e mocks para serviços externos.

## Persistência e agrupamento

A implementação usa `AppSetting`, já existente, com chaves internas `chatbot:batch:` e `chatbot:lead:`. Não adiciona tabelas nem exige migração. Operações de fila e confirmação de lead usam transação e advisory lock do PostgreSQL.

A janela padrão é 900 ms, ajustável por `CHATBOT_BATCH_WINDOW_MS` entre 100 e 1500 ms. Há um limite de espera para não manter indefinidamente uma requisição. Mensagens apenas enfileiradas não são reconhecidas como entregues/processadas antes da conclusão; uma falha retorna erro para permitir reentrega. A recuperação da fila ocorre em uma nova requisição ou retry, sem timer em segundo plano ou cron introduzido.

O motor persiste uma resposta pendente antes de enviá-la e registra um recibo depois do envio. Se a entrega ficar incerta, a conversa exige revisão humana; não há reenvio automático cego. Isso evita prometer garantia de entrega exatamente uma vez entre o banco e uma API externa, que não compartilham uma transação. Após verificar o histórico e resolver a pendência, a equipe pode liberar a automação pelo controle humano existente.

A atualização de presença usa merge atômico de JSON, evitando substituir os dados da conversa. A gravação automatizada é condicionada a a conversa não estar bloqueada nem em atendimento humano/manual. Existe ainda a pequena janela inevitável entre a última conferência e uma chamada de rede já iniciada; uma mensagem em trânsito pode chegar mesmo que um operador assuma a conversa naquele instante.

O agrupamento novo foi conectado à Evolution. Os caminhos Meta e Z-API existentes permanecem disponíveis; o transporte legado Z-API é exercitado com mock. Nenhum provedor real foi usado no simulador.

## Testes e resultados

Resultado final executado: **73 cenários distintos; 73 aprovados; 0 reprovados; 0 ignorados**. `npm run simulate:chatbot` encerrou com código 0. O build local `npm run build` concluiu com código 0, incluindo compilação, verificação de tipos e geração das páginas. `git diff --check` também passou. Nenhum teste foi marcado como aprovado sem execução.

O simulador gerou 61 transcrições fictícias; os demais cenários são verificações diretas de regras ou infraestrutura. Não somar as repetições da suíte como cenários adicionais.

Rodadas intermediárias identificaram problemas de validação, de configuração do executor e de reconhecimento de confirmação. Os casos afetados foram corrigidos e a suíte completa foi repetida. Os números acima são exclusivamente da rodada final.

Evidências geradas:

- `.test-output/lily-summary.json`: quantidade de cenários, aprovados, reprovados, ignorados e código de saída.
- `.test-output/lily-tests.tap`: saída dos testes.
- `.test-output/lily-conversations.json`: conversas fictícias, com documentos, e-mails e sequências numéricas protegidos.

Comandos reproduzíveis:

```bash
npm ci
npm test
npm run simulate:chatbot
npm run build
```

Não havia suíte de testes cadastrada no projeto antes desta tarefa. `npm test` e `npm run test:chatbot` executam a nova suíte; `simulate:chatbot` executa a mesma suíte e salva as conversas e o resumo. A contagem se refere a cenários distintos, não à soma de repetições.

Os testes cobrem os 30 cenários obrigatórios e casos adicionais de ambiguidade, manipulação de instruções, dados contraditórios, indisponibilidade da IA, falha de persistência, duplicidade concorrente, lease expirado, revisão de entrega incerta, confirmação sem lead retornado, CNPJ, controle humano durante o processamento e compatibilidade do transporte legado.

Para IA livre, os testes usam respostas simuladas e verificam preservação de estado, evidência literal, ausência de condições comerciais indevidas e retomada. Isso não representa uma avaliação estatística das respostas do modelo real.

### Exemplos de conversas simuladas

**Condição comercial durante o cadastro**

Cliente: “A instalação é gratuita?”
Lily: “A instalação é totalmente gratuita, sem taxa de instalação.”
Lily retoma o e-mail pendente, sem criar lead ou alterar a etapa.

**Informações antecipadas**

Cliente: “Meu nome é Cliente Simulado, CEP [protegido], quero o plano 800 Mega”.
A Lily mantém o nome, o CEP e o plano de R$ 70,00, e pede a próxima informação do endereço.

**Troca de plano no resumo**

Cliente: “Quero mudar para 1 GIGA”.
A Lily atualiza o plano para R$ 85,00/mês e mostra um novo resumo. Nenhum lead é criado até uma nova confirmação válida.

**IA indisponível**

Cliente: “A instalação é gratuita?”
A condição oficial continua sendo respondida pelo backend. Uma informação válida enviada em seguida continua o cadastro.

**Falha de envio**

O transporte simulado falha. O motor não apresenta o envio como sucesso, não avança silenciosamente o atendimento e sinaliza revisão humana. Uma repetição não causa um novo disparo automático.

### Erros encontrados e corrigidos

- Confirmação por substring, que podia aceitar uma frase ambígua contendo “correto”.
- “Confirmo” interceptado por uma regra ampla sobre confiança.
- CEP incompleto preenchido automaticamente com zero.
- Texto de gíria aceito como nome.
- Dados fora de ordem atribuídos ao campo errado ou repetidos.
- Data impossível/futura e e-mail malformado.
- Oferta de plano superior restrita a velocidades antigas, sem cobrir o catálogo atual.
- Descrição de uma recomendação econômica como se fosse a opção mais completa.
- Estado avançado antes de o envio estar protegido por uma resposta persistida.
- Falha entre envio e gravação do recibo sem indicação de revisão.
- Duplicidade identificada por qualquer saída posterior, em vez de por recibo do evento.
- Falta de agrupamento durável por contato.
- Risco de a presença sobrescrever memória mais recente.
- Risco de automação responder a uma conversa manual/humana.
- Atualização de venda anterior pelo telefone; confirmação com ID agora usa recibo transacional e cria um registro específico sem sobrescrever uma venda anterior.
- Falhas de configuração do próprio teste inicial, corrigidas sem marcar cenários não executados como aprovados.

## Configuração externa e limites da validação

- `OPENAI_API_KEY` e `OPENAI_MODEL`, ou as configurações equivalentes já existentes no CLICKHUB, habilitam as respostas da OpenAI. A ausência de chave mantém o fallback local.
- `OPENAI_TRANSCRIBE_MODEL` é opcional para áudio. Imagens/documentos dependem de um modelo compatível e de mídia acessível ao serviço.
- Nenhuma chave foi copiada para a Vercel nesta tarefa. A configuração de OpenAI de produção deve ser conferida antes de habilitar esses recursos.
- A configuração de Evolution existente foi preservada. Não foi enviado WhatsApp de teste nem criado lead real.
- Transações SQL, advisory locks e competição entre processos precisam de validação em um banco de staging com o mesmo pooler/versão do Supabase. Foram simulados nos testes, não executados no banco real.
- Antes de publicar, realizar validação real de áudio, imagem/PDF, acesso da API ao arquivo e disponibilidade do modelo. Os testes com mocks comprovam o comportamento do código nas respostas simuladas, não a qualidade de OCR/transcrição real.
- As defesas de prompt e o filtro de respostas livres reduzem risco, mas não provam ausência universal de alucinações ou ataques. Condições oficiais, preços, estado e registro permanecem controlados por código.
- Nenhuma classificação comercial de leads ou priorização automática foi adicionada.

A integração estruturada segue a [documentação oficial da OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), com schema e validação no backend.

## Publicação — somente após revisão

1. Revisar este relatório e o diff. Não incluir `.env`, backups, bases soltas ou arquivos pessoais no commit.
2. Configurar a chave/modelo da OpenAI no ambiente escolhido, se quiser usar IA livre e mídia. Inserir segredos pelos campos protegidos do serviço, sem colocá-los no repositório.
3. Validar em staging a fila, os locks e a concorrência com atendimento humano, usando número e banco de testes.
4. Executar os comandos de testes e build acima.
5. Fazer commit seletivo dos arquivos listados e enviar ao GitHub quando aprovado.
6. Publicar no projeto Vercel já vinculado à pasta:

```bash
npx vercel deploy --prod --scope atlas-f41c
```

Esse comando não foi executado nesta tarefa. Não é necessário executar migrações ou scripts de seed para esta alteração.

## Reversão

Para reverter antes de publicar, arquivar os arquivos novos e restaurar os originais a partir dos backups. Os arquivos novos estão listados neste documento; não remover outros arquivos do workspace.

Exemplo, a executar apenas se a reversão for desejada:

```bash
mkdir -p /tmp/clickhub-lily-arquivos-novos
mv tests scripts/simulate-chatbot.cjs src/modules/chatbot/intelligence.ts src/modules/chatbot/knowledge.ts src/modules/chatbot/services/message-batch.service.ts src/modules/chatbot/services/incoming-media.service.ts /tmp/clickhub-lily-arquivos-novos/
cp -a .backups/lily-20261101/. .
printf '\n.backups/\n.test-output/\n' >> .gitignore
npm ci
npm run build
```

O diretório de destino deve estar livre para evitar conflito com um arquivamento anterior. Os backups permanecem guardados. Após uma publicação futura, a reversão também poderá usar o deployment anterior da Vercel, preservando dados existentes. Não apagar registros de conversas, leads ou recibos para reverter código. Chaves `chatbot:` não precisam ser apagadas para usar a versão anterior.


## Encerramento definitivo após sucesso — 02/11/2026

Após enviar a confirmação de solicitação registrada com sucesso, a conversa entra em FINISHED e não recebe mais respostas automáticas. A verificação ocorre antes da interpretação conversacional da IA e também imediatamente antes de enviar uma resposta que já estivesse sendo processada. Novas mensagens permanecem no histórico. Perguntas, agradecimentos, troca de plano, áudio e o comando reiniciar não reativam o fluxo encerrado. Chamadas também não produzem resposta automática. O atendimento manual continua disponível e uma reabertura da automação exige ação explícita da equipe.

Backups desta mudança: `.backups/lily-fim-fluxo-20261102/`. Os testes 71–73 verificam silêncio após o sucesso, ausência de novas chamadas de interpretação conversacional, manutenção do histórico, chamadas posteriores e encerramento concorrente. A suíte completa e o build local passaram novamente. Alteração local, sem publicação.


## Publicação autorizada — 02/11/2026

Após autorização explícita do usuário, as melhorias foram publicadas junto ao isolamento CLICK/GIGA CLICK no commit `964f5be`. A suíte atual soma 94 cenários aprovados. A publicação e os dois webhooks foram conferidos em produção; não houve mensagem ou lead de teste. Ver `GIGA_CLICK_ISOLAMENTO.md` para o estado atual e as evidências. Os relatos anteriores de alteração somente local descrevem o estado antes desta autorização.
