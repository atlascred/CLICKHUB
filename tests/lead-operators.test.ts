import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadOperatorLabels, leadOriginText } from '../src/modules/leads/types/lead-source';

test('operadora de leads antigos vem da instância vinculada, mesmo com origem chatbot genérica', () => {
  assert.deepEqual(leadOperatorLabels({source:'chatbot',operatorInstances:['CLICK']}),['NIO FIBRA']);
  assert.deepEqual(leadOperatorLabels({source:'chatbot',operatorInstances:['GIGA CLICK']}),['VIVO FIBRA']);
  assert.deepEqual(leadOperatorLabels({source:'chatbot',operatorInstances:['GIGA CLICK','CLICK','GIGA CLICK']}),['NIO FIBRA','VIVO FIBRA']);
});
test('origem explícita é fallback; cadastro sem vínculo não recebe operadora inventada', () => {
  assert.equal(leadOriginText({source:'chatbot:click'}),'NIO FIBRA');
  assert.equal(leadOriginText({source:'chatbot:giga'}),'VIVO FIBRA');
  assert.equal(leadOriginText({source:'manual'}),'Cadastro manual');
  assert.deepEqual(leadOperatorLabels({source:'chatbot'}),[]);
  assert.equal(leadOriginText({source:'chatbot:click',operatorInstances:['GIGA CLICK']}),'VIVO FIBRA');
});
test('nome da mãe vai para copiar venda e e-mail informal continua editável no lead',()=>{
 const {buildLeadCopyText}=require('../src/modules/leads/clipboard');const {updateLeadSchema}=require('../src/modules/leads/schemas/lead.schema');const text=buildLeadCopyText({name:'Cliente Sintético',motherName:'Maria Simulada'},'venda');assert.match(text,/Nome da Mãe: Maria Simulada/);assert.equal(updateLeadSchema.safeParse({motherName:'Maria Simulada',email:'não sei meu email'}).success,true);
});
