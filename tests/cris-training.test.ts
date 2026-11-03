import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crisTrainingFor } from '../scripts/lib/cris-training';

test('treinamento do Cris mantém a identidade de cada chatbot e não inclui a estrutura de planos ou fluxo',()=>{
 for(const name of ['Lily','Lily Giga']) {
  const payload=crisTrainingFor({name,rules:{}});
  assert.deepEqual(Object.keys(payload).sort(),['personality','rules']);
  assert.ok(payload.personality.includes(name));
  const text=JSON.stringify(payload);
  assert.ok(!/\bCris\b|Claro|ALFFA/.test(payload.personality));
  assert.ok(!/R\$|55,00|99,99|109,99|139,99|Plano 350|Plano 500|recommendedPlanId|planIds|zapiToken|zapiInstanceId|steps/.test(text));
 }
});
test('treinamento conserva regras do fluxo, cobertura e configurações próprias do agente',()=>{
 const original={etapas:'Fluxo próprio',cobertura:'CEP não confirma disponibilidade',customFlag:{enabled:true},recommendedPlanId:'destination-plan'};
 const before=JSON.stringify(original);
 const payload=crisTrainingFor({name:'Lily',rules:original});
 assert.equal(payload.rules.etapas,original.etapas);assert.equal(payload.rules.cobertura,original.cobertura);
 assert.deepEqual(payload.rules.customFlag,original.customFlag);assert.equal(payload.rules.recommendedPlanId,'destination-plan');
 assert.equal(JSON.stringify(original),before);
});
test('orientações preservam silêncio final, isolamento e transparência',()=>{
 const {rules}=crisTrainingFor({name:'Lily',rules:{}});
 assert.match(String(rules.treinamentoEncerramento),/FINISHED/);assert.match(String(rules.treinamentoEncerramento),/silêncio absoluto/);
 assert.match(String(rules.treinamentoIsolamento),/Nunca misturar CLICK com GIGA CLICK/);
 assert.match(String(rules.treinamentoIdentidade),/assistente virtual/);
 assert.match(String(rules.treinamentoSeguranca),/Nunca afirmar.*sem confirmação/);
});
test('orientações incluem interpretação, dúvida concreta, recusas, espera e validação literal',()=>{
 const {rules}=crisTrainingFor({name:'Lily',rules:{}});
 assert.match(String(rules.treinamentoInterpretacao),/Perguntas e números em perguntas não autorizam preencher campos/);
 assert.match(String(rules.treinamentoEvidencias),/trechos literais/);
 assert.match(String(rules.treinamentoConfirmacao),/não equivale a autorização/);
 assert.match(String(rules.treinamentoEspera),/Nunca iniciar lembretes/);
 assert.match(String(rules.objecoes),/Pedidos explícitos de parar não recebem/);
});
