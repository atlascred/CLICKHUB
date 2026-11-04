# Campanhas pelo WhatsApp Oficial

A página `/envio-em-massa` usa exclusivamente a Cloud API da Meta. Os atendimentos NIO FIBRA e VIVO FIBRA, seus números, filas, planos e bases de CEP continuam na Evolution. Não alterar `WHATSAPP_PROVIDER` para ativar campanhas.

## Conectar após cadastrar o número

1. No [WhatsApp Manager](https://business.facebook.com/latest/whatsapp_manager), cadastre a empresa e um número destinado à conta oficial. Não migre os números dos atendimentos Evolution nesta configuração.
2. No app da empresa na Meta, obtenha as credenciais e configure-as no ambiente protegido do servidor (Vercel, ambiente Production). Nunca coloque tokens no código ou em variáveis `NEXT_PUBLIC_*`.
3. Configure:
   - `META_WHATSAPP_ACCESS_TOKEN`: token de usuário de sistema autorizado à conta, com acesso a envio e gestão de modelos (`whatsapp_business_messaging` e `whatsapp_business_management`).
   - `META_WHATSAPP_PHONE_NUMBER_ID`: identificador do número cadastrado, não o telefone com DDD.
   - `META_WHATSAPP_BUSINESS_ACCOUNT_ID`: identificador da conta WhatsApp Business (WABA).
   - `META_WHATSAPP_APP_SECRET`: segredo do app, para validar a assinatura dos eventos.
   - `META_WHATSAPP_VERIFY_TOKEN`: segredo de verificação do webhook, escolhido pela equipe.
   - `META_WHATSAPP_DEFAULT_NUMBER`: número oficial exibido na tela (opcional).
   - `META_GRAPH_API_VERSION`: versão Graph suportada pelo app; padrão `v23.0`.
4. Publique novamente para aplicar as variáveis. Configure a callback `https://clickhub-peach.vercel.app/api/whatsapp/meta/webhook` na Meta com o verify token e assine o campo `messages` da WABA. O webhook valida assinatura, WABA e Phone Number ID. Ele recebe somente os status das campanhas; respostas de clientes não entram no chatbot Evolution.
5. Crie e aprove os modelos na Meta. Na página WhatsApp Oficial, clique em **Atualizar conexão**, selecione o modelo, preencha suas variáveis e confira a prévia. A Meta pode exigir configuração de pagamento e limites da conta antes de liberar campanhas.

## Comportamento

- Até 100 contatos por campanha, separados por linha, vírgula ou ponto e vírgula. DDD obrigatório. Números inválidos bloqueiam a criação e duplicados são removidos.
- Confirmação de autorização dos destinatários obrigatória. O servidor aceita somente modelos aprovados encontrados na conta conectada.
- Variáveis posicionais e nomeadas no corpo/cabeçalho; imagem, vídeo e documento de cabeçalho por link HTTPS acessível à Meta. Modelos com botões dinâmicos, carrosséis ou componentes ainda não suportados ficam indisponíveis.
- Campanhas são privadas ao usuário criador e persistidas em `AppSetting` com prefixo operacional reservado `chatbot:meta-campaign:`. Não há migração de banco.
- Uma requisição por contato, com reserva atômica e identificação persistida da campanha para evitar reenvio por clique repetido. Mantenha a tela aberta; pendentes podem ser retomados na mesma sessão. Recarregar não inicia envios automaticamente.
- Falha explícita, envio sem confirmação, aceite pela API, entrega e leitura são estados separados. Timeouts e interrupções não repetem automaticamente o contato. Confirme na Meta antes de criar outro envio para ele.
- Os disparos antigos e seu cron foram desativados. Agendamentos existentes permanecem no histórico para consulta/cancelamento, sem processamento pela Evolution.

## Validação antes de usar

Após configurar a conta, teste com um destinatário que autorizou o recebimento e um modelo aprovado. Confira os eventos de entrega no webhook e o resultado no painel. A integração não pode ser testada contra a Meta antes do cadastro e das credenciais; os testes automatizados usam respostas simuladas.

Referência: [modelos de mensagem, WhatsApp Business](https://whatsappbusiness.com/blog/manage-message-templates-whatsapp-business-api/).
