# Cobertura por CEP do GIGA CLICK

Solicitação: utilizar todas as planilhas da pasta `CEPS VIVO` como base de cobertura somente para o agente associado ao número +55 11 96627-1717. O nome da operadora não é usado no atendimento. Planos, benefícios e fluxo da Lily permanecem próprios do CLICKHUB.

## Preparação e importação

`python3 scripts/prepare-agent-coverage.py` lê todas as abas de todos os arquivos XLSX da pasta, sem modificar as planilhas. Reconhece a coluna CEP, mantém o identificador com oito dígitos e zeros iniciais, descarta somente CEPs ausentes/inválidos e consolida endereços repetidos pelo CEP. Cidade/UF são mantidas apenas quando não há conflito entre as linhas do CEP. Logradouro e número de um endereço da planilha não são presumidos para os demais imóveis do mesmo CEP.

A extração gera manifesto com SHA-256 por arquivo, totais conciliados e lista canônica ordenada em `.test-output/coverage/`. A área temporária não é incluída no Git ou na Vercel.

`node --env-file=.env --require tsx/cjs scripts/import-agent-coverage.ts` faz somente uma prévia. Com `--apply`, importa; com `--apply --activate`, também ativa a política do agente depois de conferir a base completa.

Os registros são adicionados à tabela existente `CoverageCep`, em namespace exclusivo `agent-coverage:<agentId>:<hash>`. IDs determinísticos e `skipDuplicates` permitem retomar sem duplicar. Nada da base global é apagado ou sobrescrito. O banco só é ativado após a contagem e o hash de todos os CEPs armazenados conferirem com a extração. Falha ou importação parcial não substitui a política ativa.

Antes da importação, a versão publicada precisa anunciar `coverageVersion:1`, garantindo que as consultas globais já excluam a base por agente. Isso impede que o material em preparação afete o CLICK.

## Atendimento

- CEP na base do GIGA CLICK: prossegue na mesma sequência atual de endereço, planos e cadastro.
- CEP ausente: responde “Infelizmente, no momento ainda não temos cobertura para esse CEP.” e finaliza a solicitação como `FINISHED_UNAVAILABLE`, sem gerar lead.
- Abertura já contendo CEP, mensagens agrupadas, correção de endereço e confirmação de cadastros iniciados antes da ativação também respeitam a consulta.
- Falha de banco não é interpretada como falta de cobertura; o erro permite reentrega, sem afirmação comercial falsa.
- ViaCEP localiza endereço, mas nunca concede cobertura quando o CEP não está na base exigida.
- A aceitação pelo CEP permite continuar a solicitação; não promete aprovação cadastral, cobertura em cada imóvel ou data de instalação.
- CLICK mantém sua base e comportamento anteriores. Não há cópia do fluxo ou catálogo do Cris.
- O silêncio após `FINISHED` e o controle humano permanecem preservados.

O painel CEPs permite escolher a base por agente. A base exclusiva pode ser consultada; os controles de cadastro/importação geral ficam ocultos nesse modo para evitar alterações na base errada.

## Preservação e verificação

Backups em `.backups/coverage-20261103/`. A ativação modifica somente `rules.coveragePolicy` e a orientação textual `rules.cobertura` do agente confirmado pelo número e instância. Personalidade, demais regras, planos, preços, JSON de fluxo, chaves, tempos e demais agentes são preservados.

Há testes para CEP presente/ausente, zeros iniciais, isolamento, abertura/lotes, correção, confirmação antiga e falhas de banco. A publicação, a conferência integral dos dados e a política são verificadas antes da mensagem final autorizada para o WhatsApp do proprietário.
