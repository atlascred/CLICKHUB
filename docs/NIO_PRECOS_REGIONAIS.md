# NIO FIBRA: preços por município

Regra autorizada pelo proprietário em 05/11/2026. Aplica-se exclusivamente à instância `CLICK` (NIO). `GIGA CLICK` (VIVO) não recebe alteração de catálogo, regras ou cobertura.

O chatbot consulta o CEP no ViaCEP, usa cidade + UF e compara com as 125 localidades da imagem fornecida. A lista está em `src/modules/chatbot/nio-regional-pricing.ts`. Acentos e maiúsculas são normalizados; municípios homônimos em outro estado não recebem o benefício. Se ViaCEP estiver indisponível, usa cidade e UF da base de CEP. Localização não identificada exige confirmação do CEP antes de oferecer preços.

- Localidades BTU: preserva os três planos existentes, de R$ 55, R$ 70 e R$ 85.
- Demais localidades: 600 Mega R$ 110; 800 Mega + chip 10 GB R$ 140; 1 Giga + chip 20 GB + Globoplay grátis R$ 170; 1 Giga + 2 chips 20 GB + Globoplay grátis R$ 200.

Listagem, escolha, recomendação e upsell usam somente o catálogo elegível. A alteração de CEP refaz a classificação e invalida plano incompatível antes da confirmação. Se o cliente questiona a diferença em relação ao anúncio, o bot explica que sua cidade está fora da promoção especial, quando for o caso, e retoma a etapa atual.

## Ativação

Publicar o código antes de ativar a política: o código anterior não filtra planos por região.

`node --import tsx scripts/configure-nio-regional-pricing.ts` confere os dados sem alterar. Com `--apply`, cria os quatro planos normais vinculados somente à NIO e adiciona `rules.nioRegionalPricing`. A transação verifica que o catálogo BTU, as demais configurações NIO e o agente VIVO completo ficaram intactos. Interrompe se houver planos compartilhados. Backup privado em `.backups/nio-regional-pricing`; relatório sem credenciais em `.test-output/nio-regional-pricing/configuration.json`.

## Verificação

Testes isolados cobrem todas as cidades, homônimos, catálogos por CEP, preço do anúncio, correção do CEP, proteção contra município incorreto extraído de mídia, opção com dois chips, recomendação/upsell e cadastro final no valor normal. Também comprovam que VIVO ignora essa política. Nenhuma mensagem real é enviada pelos testes.
