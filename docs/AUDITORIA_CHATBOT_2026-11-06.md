# Auditoria dos chatbots NIO e VIVO — 06/11/2026

## Escopo e método

A fotografia dos históricos consultada contém 155 conversas (incluindo três excluídas logicamente), 3.234 mensagens, 1.593 mensagens recebidas e 53 áudios recebidos. Os textos foram examinados por conversa, com atenção às repetições, recusas, correções, transferências e etapas sem avanço. São históricos de atendimento e também incluem testes técnicos; não representam 155 clientes distintos.

Os 53 áudios foram baixados pela instância Evolution de origem. A inspeção local confirmou arquivos Opus válidos, com duração total aproximada de 9 min 56 s. Após autorização explícita do responsável, todos foram transcritos pela integração OpenAI existente e comparados com as respostas seguintes. Um resultado repetiu a instrução de transcrição em vez de conteúdo confiável; esse caso não foi tratado como fala válida do cliente. Os arquivos brutos, transcrições e dados pessoais ficaram em pasta temporária privada, fora do repositório.

## Problemas identificados e correções

| Achado | Correção |
| --- | --- |
| “Manter”, “quero manter” e pequenas variações voltavam ao menu do upgrade. | Mantém o plano original e continua a coleta, sem trocar a escolha pelo plano mais caro. |
| Escolhas por valor, como “70,00” ou “prefiro o de 55”, não eram reconhecidas. | Consulta apenas preços únicos do catálogo ativo; não cria condições comerciais novas. |
| Números como “N1”, “N 811”, “441 Ap 71” e “44 B” eram recusados ou truncados. | Reconhece o número e sua letra sem confundir a conjunção “e” com sufixo. |
| Correção do número da casa enviada durante a pergunta de complemento era armazenada como complemento. | Aplica o número corrigido e mantém a pergunta de complemento. |
| Bairro e referências enviados na correção de endereço não eram aplicados e podiam cair no tratamento genérico de nome. | Aplica campos explicitamente identificados e preserva o nome do titular. |
| Sobrenome “Nascimento” era interpretado como rótulo de data. | Preserva o sobrenome e distingue campos rotulados. |
| Nome junto com CPF válido era recusado integralmente; nomes interrompidos por “e/de/da” eram aceitos. | Separa dados numéricos ao final e solicita completar o nome quando estiver truncado. |
| Data compacta de seis dígitos e dígitos falados como “meia” não avançavam. | Reconhece esses formatos mantendo validação de data, tamanho do CEP e dígitos verificadores de documento. |
| Vencimento por extenso podia falhar ou interpretar “vinte e cinco” como cinco. | Interpreta os seis vencimentos existentes corretamente; não acrescenta dias novos. |
| Áudio pedindo “manda os planos” recebia novamente a pergunta sem a lista. | Reconhece o pedido de reenvio e conserva a etapa. |
| Falha de transcrição podia provocar repetição indefinida. | A terceira falha consecutiva de áudio sinaliza atendimento humano, preservando os dados e interrompendo respostas automáticas. |
| Um áudio gerou eco da instrução da IA. | Descarta esse resultado em vez de usá-lo como dado cadastral. |
| Pedidos explícitos de encerrar recebiam nova pergunta e lembretes. | Pausa o atendimento e os lembretes; não registra contratação nem reinicia o cadastro. |
| Conversas com outros sistemas automáticos entravam em ciclo. | Identifica mensagens automáticas padronizadas; não responde em ciclo nem envia follow-up para elas, inclusive em históricos anteriores à correção. |
| Respostas de e-mail já aceitas pelo bot impediam editar outros dados do lead no formulário. | O formulário e a API permitem preservar e editar a resposta informal sem inventar e-mail. |

Alguns problemas pertencem a versões anteriores do bot; cenários já corrigidos foram mantidos na regressão. Respostas manuais posteriores ao encerramento foram distinguidas de mensagens do chatbot: não foram usadas como novas regras comerciais.

## Nome completo da mãe

A nova pergunta vem depois do nome completo do titular e antes do CPF. As demais perguntas, etapas, planos, preços e condições comerciais foram preservados. Dados já informados continuam sendo aproveitados; cadastros concluídos não são reabertos nem recebem cobrança retroativa dessa informação.

O campo `motherName` é persistido no lead, aparece na edição, no resumo de confirmação, na exportação e em “Copiar SUBIR VENDA”. A correção pode ser solicitada pela opção 8, preservando a numeração anterior. A leitura de documentos distingue titular e filiação materna. O campo no banco é opcional para compatibilidade com cadastros antigos; novas confirmações pelo chatbot exigem sua coleta.

A implementação é compartilhada por NIO, VIVO e pelo adaptador da API oficial em Conversas de Disparo. O histórico oficial continua isolado da Evolution, com pausa manual, retomada e envio idempotente preservados.

## Validação e limites

Os testes usam dados sintéticos e simulam contratações completas, cada catálogo, persistência da mãe, correções, mensagens agrupadas, áudio interpretado/ilegível, duplicidade de webhook, retomada e falha de envio. A suíte bloqueia rede e banco reais. A validação da interface usa APIs simuladas em desktop e mobile. Não foram enviadas mensagens reais nem reprocessados webhooks de clientes durante a auditoria.

A transcrição continua sujeita a ruído, fala incompleta e ambiguidade; o bot deve solicitar esclarecimento ou encaminhar ao atendimento humano em vez de completar dados. Pedidos de agendamento ou de resultado de análise em conversas já finalizadas continuam a cargo da equipe; o bot não passa a prometer datas ou aprovações.

Validação final: 280 testes aprovados em 18 arquivos isolados e compilação de produção concluída. Na interface, a edição do nome da mãe, a preservação de e-mail informal e a cópia de venda foram conferidas em 1440 px e 390 px, sem erros de JavaScript nem alterações em leads reais.

Melhorias operacionais recomendadas, sem mexer no roteiro: destacar para a equipe os atendimentos assumidos ou que aguardam retorno após o cadastro e acompanhar a taxa de falha de transcrição. Os históricos mostram pedidos de retorno e de agendamento depois da finalização; isso depende de acompanhamento humano e não deve ser respondido com promessa automática de aprovação ou instalação.
