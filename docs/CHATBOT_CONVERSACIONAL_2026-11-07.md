# Respostas conversacionais dos chatbots

O motor compartilhado da NIO FIBRA, VIVO FIBRA e NIO nas Conversas de Disparo interpreta perguntas fora do roteiro sem abandonar a etapa de contratação.

## Comportamento

- Perguntas recebem uma única interpretação contextual: operadora, catálogo vinculado, plano selecionado, histórico recente, nomes dos campos já coletados e pergunta pendente.
- Respostas comerciais usam fatos selecionados pela IA e renderizados pelo servidor. Valores e benefícios vêm exclusivamente do catálogo da operadora atual.
- A IA pode explicar assuntos gerais e termos técnicos com linguagem natural. Condições desconhecidas devem ser apresentadas como não confirmadas.
- A resposta retoma a pergunta da etapa atual, inclusive na confirmação e na correção de um campo específico.
- Dúvidas não são salvas como e-mail nem confundidas com nome do titular/da mãe. Respostas informais de e-mail continuam aceitas sem aviso.
- Solicitações de consulta não geram aviso de CEP incompleto.
- O atendimento continua respeitando pausa, encerramento, transferência humana, confirmação explícita, recibos e proteção contra duplicidade.

## Implementação

A interpretação estruturada recebe fatos identificados por chave. O modelo retorna segmentos estruturados de texto ou referência a fato (`segments` com `kind=text` ou `kind=fact`), distinguindo assuntos gerais, finalidade dos dados e condições do catálogo. A compatibilidade com `factKeys` e referências `{{fato:chave}}` é preservada no interpretador. O servidor substitui somente chaves existentes no contexto e recusa preços, benefícios, operadoras ou ações inventadas no texto livre. Se uma paráfrase não passar na validação, os fatos selecionados continuam disponíveis como resposta segura.

As respostas contextuais substituem o filtro genérico que bloqueava palavras comerciais legítimas. A segunda chamada de geração que podia atrasar a resposta foi removida. O fluxo de dados, os planos e os preços cadastrados continuam sob controle do motor existente.

## Verificação

- 314 testes locais em 18 arquivos, com banco e APIs simulados.
- Perguntas de adesão/ativação, perguntas sobre planos específicos, contexto de NIO/VIVO, assuntos gerais com números, coleta de e-mail, nome da mãe e correções.
- Regressão da contratação completa, pausa, confirmação e Conversas de Disparo.
- Compilação de produção.
- Nenhuma mensagem enviada a clientes nesta validação.
- Após autorização explícita do usuário, foram executados testes reais de geração com perguntas simuladas e os catálogos cadastrados; sem dados reais de clientes, alterações no banco ou envio ao WhatsApp.
- A rodada inicial revelou repetição da pergunta pendente, duplicação de benefícios, classificação de pergunta como dado e confusão entre conceito geral e catálogo. Esses problemas foram corrigidos e cobertos pela regressão local. A avaliação também identificou imprecisão em uma explicação técnica; foram adicionadas referências e instruções para priorizar fatos sobre suposições. A geração continua probabilística, sem garantia de ausência de erros em perguntas futuras.
- A matriz final de 20 cenários (10 por operadora) passou na avaliação: respostas de adesão/ativação, download/upload, benefícios do plano selecionado, plano de 800 Mega, benefício não confirmado, etapa posterior à confirmação e finalidade do nome da mãe, comparação técnica de alcance sem fio e um cálculo simples.
- Etapas e planos preservados em 20/20 cenários, nenhuma criação de lead. A medição da IA não inclui entrega real pelo WhatsApp.
- Contradições do modelo são tratadas: uma pergunta com referência a fatos não é tomada como dado; um plano encontrado nos fatos não é apresentado como desconhecido; benefícios não confirmados não geram anúncios de alternativas nem promessas.

Referência de integração: [documentação oficial da OpenAI sobre instruções e contexto](https://developers.openai.com/api/docs/guides/prompt-engineering).

Referências técnicas: [Bluetooth SIG sobre alcance e seus fatores](https://www.bluetooth.com/learn-about-bluetooth/key-attributes/range/) e [coexistência na faixa de 2,4 GHz](https://www.bluetooth.com/learn-about-bluetooth/key-attributes/reliability/).
