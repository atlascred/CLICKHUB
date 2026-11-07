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

A interpretação estruturada recebe fatos identificados por chave. O modelo pode selecionar `factKeys` e usar referências `{{fato:chave}}` na resposta. O servidor substitui somente chaves existentes no contexto e recusa preços, benefícios, operadoras ou ações inventadas no texto livre. Se uma paráfrase não passar na validação, os fatos selecionados continuam disponíveis como resposta segura.

Foram removidos o filtro genérico que bloqueava palavras comerciais legítimas e a segunda chamada de geração que podia atrasar a resposta. O fluxo de dados, os planos e os preços cadastrados continuam sob controle do motor existente.

## Verificação

- 306 testes locais em 18 arquivos, com banco e APIs simulados.
- Perguntas de adesão/ativação, perguntas sobre planos específicos, contexto de NIO/VIVO, assuntos gerais com números, coleta de e-mail, nome da mãe e correções.
- Regressão da contratação completa, pausa, confirmação e Conversas de Disparo.
- Compilação de produção.
- Nenhuma mensagem enviada a clientes nesta validação.
- Qualidade da geração real com catálogos cadastrados ainda não validada: esse teste requer autorização para enviá-los ao serviço da OpenAI.

Referência de integração: [documentação oficial da OpenAI sobre instruções e contexto](https://developers.openai.com/api/docs/guides/prompt-engineering).
