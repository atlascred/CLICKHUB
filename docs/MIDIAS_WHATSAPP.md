# Áudios e anexos no CLICKHUB — 03/11/2026

## Causa e correções

A Evolution instalada informou versão 2.3.7. O envio de áudio usava o endpoint genérico `sendMedia`; o fallback multipart tentava enviar o arquivo no campo `media`, enquanto a rota oficial aceita `file`. O fallback também mascarava o erro anterior e podia repetir um envio após uma falha de resultado incerto.

- Áudio passa por `sendWhatsAppAudio`, campo JSON `audio`, com conversão habilitada para Ogg/Opus. A Evolution converte os formatos gravados pelo navegador.
- Imagens, vídeos e documentos continuam em `sendMedia`, com tipo, MIME, nome e legenda. A alternativa multipart utiliza `file` e só é tentada após rejeição HTTP 415. Timeout e erro 5xx não geram reenvio automático.
- Timeout de mídia é separado do envio de texto. Texto e chatbot mantêm seus tempos de resposta.
- Fonte do áudio é guardada no histórico, como os demais anexos.
- Atualizações de entrega/leitura fazem merge atômico do JSON, preservando arquivo, MIME e payload de origem; mantêm filtro pelo agente.
- A central apresenta imagem, player de áudio, player de vídeo, documento, abertura e download. Falha de envio mantém o arquivo e texto selecionados.
- Gravação escolhe um MIME suportado pelo navegador e a extensão correspondente; trata gravação vazia, falta de suporte e permissão negada. Texto junto com áudio é mantido para envio separado, pois áudio não tem legenda no WhatsApp.

Referência do campo e rotas: [código oficial da Evolution 2.3.7](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/routes/sendMessage.router.ts). Conversão de áudio: [implementação oficial](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts).

## Recebimento e reprodução

O parser reconhece anexos em mensagens normais e envelopes ephemeral/view-once/document-with-caption. Base64 já disponível tem prioridade sobre a URL criptografada.

URLs `.enc` do WhatsApp não são tratadas como arquivos reproduzíveis, mesmo quando o servidor retorna HTTP 200. O download utiliza `chat/getBase64FromMediaMessage/{instance}` com o envelope completo (chave e mensagem), na instância da conversa. Não tenta baixar com a chave do outro agente.

O proxy exige login/permissão, respeita a conversa atribuída ao funcionário e a restrição de agente, não retorna tokens ou URLs de origem ao navegador e suporta HTTP Range para áudio/vídeo. Documentos ativos são baixados como anexo; respostas usam `nosniff` e cache privado desativado.

## Processamento por IA

O proprietário autorizou explicitamente o envio de áudios, imagens e documentos recebidos à OpenAI para transcrição e extração de dados, quando houver chave válida. A autorização foi obtida após a revisão automática solicitar confirmação desse envio externo.

A mídia é descriptografada pela Evolution antes da interpretação. PDFs/arquivos em memória usam `file_data` e nome; imagens usam `image_url`, conforme a [documentação oficial da OpenAI / OpenAI Docs](https://developers.openai.com/api/docs/guides/file-inputs). Áudios com codecs na data URL são aceitos.

Sem chave ou com arquivo indisponível, a Lily não inventa conteúdo: o anexo permanece no painel e o fluxo pode solicitar texto. Conversas encerradas, bloqueadas ou sob controle humano não iniciam novo processamento de mídia por IA. O motor mantém a verificação final de controle antes de responder.

## Limites e verificação

- Uploads pelo painel: até 3 MB por arquivo; arquivos vazios são recusados com mensagem clara.
- Reprodução/download pelo proxy: até 25 MB.
- 136 testes automatizados, incluindo envio, recepção, envelopes, isolamento, falhas, permissões, ranges, PDFs e transcrição simulada.
- Navegador com APIs simuladas: quatro anexos exibidos, imagem decodificada, áudio reproduzido, metadados do vídeo conferidos e gravação por microfone testada; sem erro de cliente ou overflow em celular.
- Merge de status e isolamento verificados no Supabase em transação revertida.
- Testes reais foram autorizados somente para o número do proprietário terminado em 9114. Evidências locais ficam em `.test-output/`, sem credenciais ou conteúdo de outros contatos.

Backup local anterior: `.backups/media-fix-20261103/`. Planos, preços, treinamento e ordem do fluxo não são alterados por esta correção.
