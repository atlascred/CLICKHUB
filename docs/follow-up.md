# Follow-up dos chatbots

O endpoint `/api/cron/conversations-follow-up` aceita apenas o `CRON_SECRET` do ambiente em `Authorization: Bearer …`. GET e POST são equivalentes. `?dryRun=1` é somente leitura e retorna totais, sem dados pessoais.

O agendamento fica no Supabase Cron, job `clickhub-conversations-follow-up`, e verifica as pendências a cada minuto. Cada conversa recebe no máximo três lembretes, separados por pelo menos duas horas. A configuração está em `AppSetting`, chave `chatbot:followup:settings`, com `enabled`, `instances` e `activatedAt`. O primeiro envio nunca acontece antes de duas horas da ativação. Conversas sem atividade do bot nas últimas 24 horas são excluídas.

O lembrete menciona a informação pendente da etapa atual. Não altera estado, cadastro, plano, responsável ou memória da conversa. A resposta do cliente segue pelo webhook normal e pelo mesmo fluxo. Uma nova resposta do bot inicia uma nova contagem.

Atendimentos manuais, bloqueados, pausados, encerrados, com responsável ou resposta pendente não recebem lembretes. Mensagens manuais do celular e do CRM também suspendem a sequência. Pedidos de pausa ou desinteresse na última mensagem do cliente são respeitados.

Cada tentativa é reservada com uma chave única em `AppSetting`: `chatbot:followup:<conversa>:<mensagem-do-bot>:<etapa-do-lembrete>`. Uma falha incerta recebe `review_required` e não é reenviada automaticamente. O histórico guarda o identificador real da Evolution e usa a deduplicação de saída, inclusive quando o webhook chega primeiro.

Ativação, após publicar o endpoint e configurar a mesma credencial no ambiente e no Vault:

```sh
node scripts/activate-follow-up.cjs --instance=CLICK --instance='GIGA CLICK'
node scripts/activate-follow-up.cjs --instance=CLICK --instance='GIGA CLICK' --apply
```

A primeira chamada somente verifica. A segunda cria as extensões necessárias, armazena a credencial no Vault, ativa exclusivamente as instâncias informadas e agenda o job. O script é idempotente e guarda a configuração anterior em `.backups/follow-up/`, fora da publicação e do Git. Para suspender, configure `enabled: false` nessa chave. Não desative jobs de outros projetos.
