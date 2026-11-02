# Tempo de resposta da Lily — 02/11/2026

Ajuste aplicado aos agentes CLICK e GIGA CLICK no mesmo CRM, preservando a separação de credenciais, planos, filas e conversas.

## Causas identificadas

- Os dois agentes estavam configurados com atraso artificial de 2 a 4 segundos antes do envio.
- A fila abria uma transação com lock e várias operações para cada alteração, inclusive verificações sem mudança.
- Havia consultas repetidas ao agente e ao catálogo, leituras desnecessárias após gravações e consultas independentes executadas em sequência.
- O remetente autenticado pelo webhook era consultado novamente na Evolution a cada resposta.
- Entradas simples do cadastro também passavam pela interpretação de IA/configuração do serviço.

## Alterações

- `enableReplyDelay=false` nos dois agentes; os limites antigos foram preservados. Backup local das configurações em `.backups/lily-speed-20261102/agent-timing.json`.
- Janela padrão de agrupamento reduzida de 900 para 300 ms, com espera local antes de consultar a fila. Uma configuração explícita de ambiente continua sendo respeitada.
- Fila persistente com comparação atômica do JSON anterior: uma escrita concorrente exige repetição da operação. Duplicatas e verificações sem mudança não geram gravação. Conflitos esgotados geram erro para reentrega, sem confirmar processamento.
- Reutilização do agente e dos planos já carregados pelo webhook autenticado, validando a instância. Sem cache compartilhado entre agentes.
- Consultas independentes de histórico/controle em paralelo e remoção apenas das leituras posteriores cujo resultado não era utilizado.
- Remetentes brasileiros normais do webhook não exigem uma consulta adicional na Evolution; números ambíguos mantêm o caminho anterior.
- Cadastro estruturado e respostas oficiais usam o fluxo local; perguntas livres continuam disponíveis para interpretação.
- Endereço local completo dispensa consulta ao ViaCEP.

As gravações de resposta preparada, envio iniciado e recibo continuam ativas. A checagem final de controle humano/bloqueio e o silêncio após `FINISHED` foram preservados.

## Validação

- 101 testes automatizados aprovados, incluindo agrupamento, duplicatas, conflitos CAS, recuperação, isolamento, catálogo por instância, atendimento humano, falhas de persistência e silêncio após encerramento.
- CAS JSON validado no Supabase em uma transação totalmente revertida; nenhum registro de teste persistido.
- Teste determinístico de uma mensagem na fila: somente três operações de armazenamento (enqueue, claim, finalize), sem consulta durante a janela de agrupamento.
- Nenhuma mensagem real de WhatsApp enviada nos testes. O tempo completo percebido pelo cliente ainda depende da Evolution, rede e execução na hospedagem; não foi medido por uma conversa real nesta validação.
