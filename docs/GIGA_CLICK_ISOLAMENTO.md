# CLICK e GIGA CLICK — agentes isolados no mesmo CRM

Data: 02/11/2026.

## Resultado e estado atual

O sistema continua sendo um único CLICKHUB, com os mesmos usuários e módulos. Foram separados os agentes, as instâncias WhatsApp, credenciais, catálogos, conversas, memória, histórico, controles de bloqueio/atendimento humano, IDs de mensagens, filas e origens de envio.

- **CLICK** mantém os planos de R$ 55,00, R$ 70,00 e R$ 85,00 e seus benefícios anteriores.
- **GIGA CLICK** usa os planos de R$ 99,99, R$ 109,99 e R$ 139,99, todos com Globoplay grátis.
- O agente GIGA e seus três planos já foram cadastrados no Supabase.
- A credencial própria da GIGA foi validada por consulta de conexão: instância aberta.
- A variável secundária `EVOLUTION_INSTANCES_JSON` foi salva localmente e preparada na configuração protegida da Vercel.
- Os valores das variáveis da CLICK foram comparados com o backup e permaneceram iguais.
- **Nenhum deploy foi executado nesta etapa. O webhook da GIGA continua desligado.**

A ativação depende da publicação revisada do código, conforme a instrução anterior de não publicar automaticamente. Não apontar a GIGA para a versão antiga do webhook.

## Planos GIGA

| Plano | Mensalidade | Benefício informado |
|---|---:|---|
| 600 MEGA | R$ 99,99 | Internet Fibra 600 Mega e Globoplay grátis |
| 800 MEGA | R$ 109,99 | Internet Fibra 800 Mega e Globoplay grátis |
| 1 GIGA | R$ 139,99 | Internet Fibra 1 Giga e Globoplay grátis |

Não foram acrescentados chips, roteadores ou prazo do Globoplay, pois essas condições não foram informadas para a GIGA. Não prometer gratuidade vitalícia nem limitar o benefício a 12 meses sem nova confirmação comercial.

## Como o isolamento funciona

1. Cada instância precisa corresponder exatamente a um agente ativo. Uma instância desconhecida ou duplicada falha, sem usar o primeiro agente como alternativa.
2. A vinculação usa o campo já existente `Agent.zapiInstanceId`, tratado como identificador da instância WhatsApp. Não foi necessário criar outro sistema, outro banco ou executar migrações.
3. As consultas de conversa e os bloqueios usam telefone **e agente**, de modo que o mesmo cliente pode falar com os dois números independentemente.
4. Planos são registros diferentes, vinculados exclusivamente ao agente correspondente. A sincronização da CLICK não arquiva ou altera planos da GIGA.
5. O contexto assíncrono da requisição fixa a instância de envio, servidor, chave e número. Não se alteram variáveis globais para trocar de agente entre requisições.
6. Mensagens e recibos recebem identidade por instância. Um ID repetido nos dois WhatsApps não é tratado como a mesma mensagem.
7. Filas de mensagens e histórico de disparos são separados por instância. O processador de agendamentos percorre as instâncias com contextos independentes.
8. Presença, leitura e atualizações de mensagens são limitadas à origem correta. A leitura de mídia também usa a instância da conversa.
9. O envio manual resolve a instância pela conversa selecionada, valida o destino e recusa uma indicação conflitante de agente.
10. No painel de conversas há seletor CLICK/GIGA CLICK. A gestão de planos também seleciona o agente. Requisições antigas não substituem a lista após uma troca de seleção.
11. O histórico da CLICK permanece disponível. Conversas antigas sem agente são vinculadas à CLICK somente no primeiro cadastro da GIGA, antes de ela receber eventos.
12. Os leads continuam no mesmo CRM. Duas contratações do mesmo telefone podem gerar registros distintos e preços próprios; não se sobrescreve uma venda anterior pelo telefone.
13. O encerramento FINISHED continua silencioso por conversa. Encerrar CLICK não encerra GIGA.

As credenciais secundárias ficam somente no ambiente do servidor. A lista de agentes para o seletor retorna identificador, nome da instância e número, sem chave de API. Não foi criada uma separação de empresas, usuários, permissões, financeiro ou de todo o sistema.

## Alterações principais

Arquivos novos:

- `src/services/evolution-context.ts`: credenciais por instância, contexto assíncrono, validação de URL/payload e identidade de mensagens.
- `src/services/whatsapp-agent.ts`: seleção segura do agente para operações manuais.
- `src/app/api/whatsapp/agents/route.ts`: metadados seguros para o seletor.
- `scripts/lib/giga-commercial-plans.ts`: catálogo exclusivo da GIGA.
- `scripts/lib/configure-giga-agent.ts`: cadastro idempotente, isolado e transacional.
- `scripts/lib/activate-giga-webhook.ts`: verificações antes de ativar o webhook da GIGA.
- `scripts/configure-giga-agent.ts`: conferência, aplicação e ativação explícitas.
- `tests/agent-isolation-fixture.ts`: banco simulado compartilhado pelos dois agentes.

Arquivos ajustados:

- Serviço Evolution e handler de webhook.
- Repositórios de chatbot, agentes e planos.
- Motor e serviço de conversas.
- APIs de conversas, envio, mídia e disparos/agendamento.
- Painéis de conversas e gestão de agentes/planos.
- Schemas/tipos de agente e plano.
- Scripts de sincronização da CLICK.
- `.env.example` e testes.

Backups anteriores às alterações: `.backups/giga-click-20261102/`. Há uma cópia privada do `.env` anterior à variável secundária, com permissão 0600. Esse diretório é excluído do Git e do envio à Vercel; não compartilhar o backup de ambiente.

## Evidências

- `npm run simulate:chatbot`: **94 cenários aprovados, 0 reprovados, 0 ignorados**.
- `npm run build`: aprovado.
- `tsc --noEmit`: aprovado.
- `git diff --check`: aprovado.
- Conferência real de leitura no Supabase: dois agentes e dois conjuntos distintos de três planos, com valores corretos.
- Consulta real à Evolution: GIGA conectada; webhook novo ainda não configurado/ativo.
- Comparação do ambiente primário com o backup: variáveis da CLICK preservadas.

Artefatos:

- `.test-output/lily-summary.json`: contagem da suíte.
- `.test-output/lily-tests.tap`: execução dos testes.
- `.test-output/lily-conversations.json`: conversas simuladas com dados protegidos.
- `.test-output/giga-registration.json`: conferência dos catálogos e estado dos webhooks, sem tokens.

Os novos testes incluem contextos simultâneos, credenciais e servidores distintos, mesmo telefone nos dois agentes, ID de mensagem repetido entre instâncias, bloqueio e encerramento independentes, plano/lead correto em cada agente, duplicidade de mapeamento, cadastro idempotente, ausência de cópia de credenciais, filas separadas e recusa de ativação em código antigo ou com chave incorreta.

Os testes de envio, concorrência e contratação usam mocks, sem WhatsApp ou leads reais. A criação dos agentes e catálogos foi a ação real solicitada, separada das simulações. Ainda não foi realizada conversa real pelo novo webhook. O seletor passou pela compilação, mas não houve validação visual no navegador nesta etapa.

## Publicação e ativação pendentes

As alterações locais também incluem as melhorias de inteligência e a regra de silêncio após conclusão preparadas anteriormente. Revisar o conjunto antes de publicar.

Depois de autorizar a publicação:

1. Fazer commit seletivo dos arquivos de código, testes e documentação. Não incluir `.env`, backups ou bases pessoais.
2. Publicar no projeto CLICKHUB já vinculado:

```bash
npx vercel deploy --prod --scope atlas-f41c
```

3. Conferir a publicação e a disponibilidade das instâncias.
4. Ativar somente a GIGA com o procedimento que valida a versão, a chave no backend e a conexão antes de editar o webhook:

```bash
node --env-file=.env --import tsx scripts/configure-giga-agent.ts --apply --activate-webhook
```

O script não altera o webhook da CLICK nem envia mensagem de teste. O evento usado na conferência é ignorado pelo motor e não cria conversa ou lead.

A URL futura da GIGA é:

```text
https://clickhub-peach.vercel.app/api/whatsapp/webhook/instances/GIGA%20CLICK
```

Eventos: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `PRESENCE_UPDATE`. `byEvents` permanece desligado. O cabeçalho da própria instância autentica o callback. Esse formato segue o [schema oficial da Evolution](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/integrations/event/webhook/webhook.schema.ts).

## Reversão e preservação

Se for preciso reverter o código, usar os backups ou o deployment anterior. Não apagar conversas, leads ou planos históricos. Para pausar a nova integração, desligar somente o webhook ou o agente GIGA; a CLICK mantém o webhook e o catálogo próprios. Não copiar a chave da GIGA para as variáveis primárias da CLICK.

O cadastro é idempotente: executar novamente com `--apply` mantém os registros da GIGA em vez de duplicá-los. Sem flags, o comando apenas confere os cadastros e não escreve no banco:

```bash
node --env-file=.env --import tsx scripts/configure-giga-agent.ts
```
