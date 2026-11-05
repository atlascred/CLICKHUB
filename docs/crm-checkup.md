# Checkup de estabilidade — 05/11/2026

## Correções

- Requisições das telas principais têm prazo máximo, validam respostas JSON e mostram falhas de rede. Operações de escrita não são repetidas automaticamente após timeout, evitando envios duplicados de resultado incerto.
- Formulários de leads, usuários, agentes, compromissos, despesas, cobertura e configurações recuperam seus botões após falhas e exibem o erro.
- Recursos compartilhados descartam respostas antigas após troca de filtro ou desmontagem. A troca de NIO/VIVO não pode aplicar dados atrasados de outro filtro.
- Conversas preservam rascunhos por contato, inclusive quando um envio termina depois da troca de contato. Novos textos/anexos não são apagados pela conclusão de um envio anterior.
- Atualizações recentes mantêm mensagens antigas já carregadas e evitam levar a rolagem ao final enquanto o atendente lê o histórico.
- Iniciar conversa tem bloqueio de envio em andamento. Erros de envio preservam o texto para conferência e tentativa manual.
- Storage indisponível não derruba autenticação/telas. Cache de usuário é descartado após rejeição de autenticação. Login restringe redirecionamentos a caminhos internos.
- Rotas antigas de conversas/envio aplicam o escopo de agente e proprietário usado na caixa atual. Consultas antigas não retornam tokens do agente nem hash de senha do proprietário. Listagem restrita de usuários também remove hash de senha.
- Follow-up pode recuperar uma reserva cancelada antes do envio; reservas em envio, concluídas ou de entrega incerta continuam protegidas contra repetição.
- Confirmações numéricas distinguem aceite pelo servidor de entrega ao destinatário. Referência: [enum Status do Baileys](https://github.com/WhiskeySockets/Baileys/blob/master/WAProto/WAProto.proto).
- Filtro Hoje usa o calendário de São Paulo, com formatador reutilizado para evitar custo repetido em listas grandes.
- Comandos de lint/testes foram corrigidos. O executor de testes exige contagem real de casos executados e falha quando o subprocesso não pode iniciar.

## Validação

- 207 testes automatizados em 15 arquivos, incluindo isolamento NIO/VIVO, follow-up, mídias, permissões, navegação e falhas de requisição.
- Build de produção e análise estática do projeto.
- 49 verificações de telas em celular e computador, sem erros JavaScript ou transbordamento horizontal detectado.
- Navegação de lead para conversa: contato além da primeira página, escolha da operadora, contato novo e acesso negado.
- Falhas simuladas no navegador: cadastro sem rede, envio com resposta HTML de erro, armazenamento bloqueado, resposta atrasada de filtro e conclusão de envio após troca de contato. Rascunhos e botões verificados.
- Consulta de saúde do banco e histórico recente do cron, sem envio de mensagens reais durante este checkup.

Os cenários de escrita no navegador usam APIs simuladas. Esta revisão cobre os defeitos encontrados e os fluxos testados; não comprova ausência de qualquer defeito futuro, indisponibilidade de provedores ou comportamento específico de todos os dispositivos.
