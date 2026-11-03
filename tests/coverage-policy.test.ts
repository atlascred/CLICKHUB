import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coverageDataset} from '../src/modules/chatbot/coverage-policy';
import {CepRepository,coverageScopeWhere} from '../src/repositories/cep.repository';

test('base vinculada a outro agente ou configuração incompleta falha fechada',()=>{
 assert.equal(coverageDataset({id:'click',rules:{}}),undefined);
 assert.equal(coverageDataset({id:'giga',rules:{coveragePolicy:{mode:'required',dataset:'agent-coverage:giga:hash'}}}),'agent-coverage:giga:hash');
 assert.throws(()=>coverageDataset({id:'click',rules:{coveragePolicy:{mode:'required',dataset:'agent-coverage:giga:hash'}}}));
 assert.throws(()=>coverageDataset({id:'giga',rules:{coveragePolicy:{mode:'required'}}}));
});
test('consultas globais excluem bases por agente; consultas do agente usam namespace exato',async()=>{
 const queries:any[]=[];const repo=new CepRepository({coverageCep:{findFirst:async(q:any)=>{queries.push(q);return null;},findMany:async(q:any)=>{queries.push(q);return[];}}} as any);
 await repo.findByCep('01139000');assert.deepEqual(queries[0].where,{cep:'01139000',available:true,deletedAt:null,...coverageScopeWhere()});
 await repo.findByCep('01139000','agent-coverage:giga:hash');assert.equal(queries[1].where.importedFrom,'agent-coverage:giga:hash');assert.equal(queries[1].where.OR,undefined);
 await repo.findManyByCeps(['01139000']);assert.deepEqual(queries[2].where.OR,coverageScopeWhere().OR);
});

test('salvar regras pelo editor não remove nem troca a política de cobertura dedicada',async()=>{
 const {AgentRepository}=require('../src/repositories/agent.repository');let payload:any;
 const policy={mode:'required',dataset:'agent-coverage:giga:hash'};
 const repo=new AgentRepository({agent:{findUnique:async()=>({rules:{coveragePolicy:policy}}),update:async(q:any)=>{payload=q;return q;}}} as any);
 await repo.update('giga',{rules:{rule_1:'Nova orientação'}});assert.deepEqual(payload.data.rules.coveragePolicy,policy);assert.equal(payload.data.rules.rule_1,'Nova orientação');
 await repo.update('giga',{rules:{coveragePolicy:{mode:'disabled'}}});assert.deepEqual(payload.data.rules.coveragePolicy,policy);
});

test('substituir a base global preserva as bases exclusivas dos agentes',async()=>{
 let deletion:any;
 const repo=new CepRepository({coverageCep:{deleteMany:async(q:any)=>{deletion=q;return{count:0};},createMany:async()=>({count:1})}} as any);
 await repo.createManyPreservingRows([{cep:'01139000'}]);
 assert.deepEqual(deletion.where,{importedFrom:{not:'cadastro-manual'},...coverageScopeWhere()});
});
