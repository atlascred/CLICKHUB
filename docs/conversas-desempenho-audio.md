# Conversas: envio, teclado, áudio e operadora — 05/11/2026

## Defeitos encontrados e correções

- O compositor não tinha tratamento de Enter. Enter agora envia, Shift+Enter mantém a quebra de linha e o campo cresce até o limite visual. Composição de teclado e repetição de tecla não iniciam envios extras.
- O envio mantinha o botão ocupado enquanto recarregava a listagem. A resposta agora contém somente a mensagem confirmada pelo servidor, inserida no histórico imediatamente. A atualização da lista acontece em segundo plano; erros preservam o rascunho e não geram repetição automática.
- O adaptador de envio consultava o histórico completo antes e depois de chamar a integração. Agora consulta apenas o destino autorizado e devolve o recibo da mensagem salva. Removida a espera artificial de digitação do envio manual; o fluxo do bot permanece independente.
- O nome da instância não era retornado pela API de conversas. Lista e detalhe agora incluem a instância de origem para apresentar NIO FIBRA (CLICK) e VIVO FIBRA (GIGA CLICK), inclusive quando os bots têm o mesmo nome.
- O leitor de mídia aceitava `raw.data.source`, cujo valor pode ser o sistema do dispositivo, como `android`. Essa palavra era decodificada como se fosse Base64 e produzia um arquivo inválido de 5 bytes. O parser passa a usar campos de mídia e ignora os identificadores de plataforma também nos registros históricos. A validação recuperou um áudio OGG/Opus real com 22.468 bytes, cuja assinatura e estrutura foram conferidas sem reproduzir ou expor o conteúdo.
- Leituras de trechos do mesmo anexo usam cache temporário de até 32 MiB/60 segundos no servidor, evitando repetir a descriptografia para cada Range. A autorização de acesso à mensagem ocorre antes de consultar o cache. Falhas não são armazenadas e as instâncias têm chaves distintas.
- O player apresenta carregamento e opção de tentar novamente. Mídia permanece privada e sem cache público.
- Conversas recentes já abertas são reapresentadas por cache limitado em memória da tela, com atualização pelo servidor. As opções de responsáveis deixam de ser consultadas em toda atualização da lista.
- A consulta de detalhe seleciona somente campos públicos do agente e do proprietário.

## Validação

- 213 testes automatizados em 16 arquivos, com integração de WhatsApp e banco simulados.
- Testes de navegador em 1500 e 390 pixels: Enter, Shift+Enter, prevenção de envio duplicado, mensagem confirmada antes de uma atualização bloqueada, rótulos NIO/VIVO na lista/cabeçalho, reprodução de áudio sintético e reapresentação de conversa já aberta.
- Regressão da navegação a partir dos leads, contato fora da primeira página, seleção de operadora e acesso negado.
- Áudio real existente: leitura autorizada na instância de origem, assinatura OggS e codec Opus conferidos. Nenhuma mensagem real foi enviada durante os testes.
- Build de produção e conferência posterior em produção.

O envio externo foi validado por simulação, preservando os clientes reais. A resposta da Evolution e a conexão do usuário ainda influenciam o tempo de entrega. Os testes de layout mobile usam navegador automatizado; não equivalem a teste em todos os modelos físicos de iPhone/Android.
