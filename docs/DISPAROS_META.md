# Disparos e Conversas de Disparo

A área oficial usa `/envio-em-massa`, `/envio-em-massa/conversas` e `/envio-em-massa/historico`. As funções seguem o projeto Connecta: campanhas de até 100 contatos, teste individual, mensagens por modelo aprovado, texto livre na janela de atendimento, responsáveis, filtros, bloqueio, exclusão lógica, etiquetas, respostas rápidas, gravação MP3 e anexos. O histórico é persistido no servidor e pode ser exportado em CSV.

Modelos em análise aparecem indisponíveis para envio. Texto e mídia exigem uma mensagem recebida do cliente nas últimas 24 horas, conferida novamente pelo servidor antes de enviar. Campanhas só iniciam com ação explícita do operador; continuam usando a fila com reserva atômica por destinatário. Nenhuma mensagem é enviada automaticamente pelo acesso a uma página.

O webhook oficial valida assinatura, WABA e Phone Number ID, percorre todos os eventos e persiste respostas na caixa oficial. Recebimentos duplicados são ignorados. Solicitações manuais possuem chave idempotente; entregas incertas não são repetidas automaticamente. Entrega e leitura não são rebaixadas por eventos atrasados, inclusive quando o webhook chega antes do retorno HTTP.

As conversas oficiais usam `agentId=null`, estados `DISPATCH_*` e `memory.source=meta-dispatch`. A chave primária é determinística por número oficial e destinatário. O repositório das conversas comuns e a busca de conversas dos bots excluem esse prefixo. A caixa oficial exige as permissões já existentes `agents:edit` e `conversations:view`; funcionários acessam apenas as conversas atribuídas a eles, e administradores atribuem responsáveis. Nenhuma alteração no catálogo, nas regras ou no provedor dos bots NIO/VIVO.

Etiquetas e mensagens rápidas usam chaves operacionais `chatbot:dispatch-*`, protegidas das configurações genéricas. Mídias são consultadas por uma rota autenticada, que verifica o acesso à conversa antes de baixar o arquivo na Meta. Envio pelo navegador limitado a 3 MB. O gravador gera MP3 com o mesmo encoder local usado no Connecta e limita gravações a 3 minutos.

Validação: suíte automatizada e cenários de webhook em lote, isolamento, janela, idempotência e status antecipados; teste visual de desktop/mobile com campanhas sintéticas e gravação de áudio; consultas reais de leitura confirmando o contrato do banco. Sem envio real a clientes.
