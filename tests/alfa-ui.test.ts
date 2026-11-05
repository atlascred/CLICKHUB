import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conversationAgentWhere, leadSourceWhere, resolveLeadAgentScope } from '../src/lib/lead-source-access';
import { InboxService } from '../src/modules/conversas/services/inbox.service';
import { InboxRepository } from '../src/repositories/inbox.repository';
import { campaignContacts } from '../src/modules/envio-em-massa/services/mass-message.service';
const admin:any={id:'admin',role:'ADMIN',permissions:{}};
const employee:any={id:'employee',role:'EMPLOYEE',permissions:{'leads.onlyClick':true}};
test('filtros usam vínculos CLICK/GIGA reais, sem mudar source do chatbot',()=>{
 assert.deepEqual(conversationAgentWhere(admin,'giga'),{agent:{zapiInstanceId:'GIGA CLICK'}});
 assert.deepEqual(conversationAgentWhere(employee,'giga'),{agent:{zapiInstanceId:'CLICK'}});
 assert.equal(resolveLeadAgentScope(admin,'both'),'both');
 assert.deepEqual(leadSourceWhere(employee,'giga'),{conversations:{some:{agent:{zapiInstanceId:'CLICK'}}}});
 assert.deepEqual(leadSourceWhere(admin),{});
});
test('repositório combina restrição de funcionário com instância; detalhe mantém paginação',async()=>{
 const queries:any[]=[];
 const repo=new InboxRepository({chatConversation:{findMany:async(q:any)=>{queries.push(q);return[];},findFirst:async(q:any)=>{queries.push(q);return null;}}} as any);
 await repo.listConversations({user:employee,agentScope:'giga',skip:20,take:20});
 assert.equal(queries[0].where.ownerUserId,'employee');assert.equal(queries[0].where.agent.zapiInstanceId,'CLICK');assert.equal(queries[0].skip,20);
 await repo.getConversationById('conversation',employee,{skip:40,take:20});
 assert.equal(queries[1].where.ownerUserId,'employee');assert.equal(queries[1].messages,undefined);assert.equal(queries[1].select.messages.skip,40);
});
function fixture(state='ASK_EMAIL', memory:any={}, ownerUserId:string|null=null){
 let tagWrites=0,ownerWrites=0;const row:any={id:'conversation',phone:'5511900000000',state,memory,ownerUserId,updatedAt:new Date(),lead:null,agent:{id:'click',name:'Lily'},owner:null,messages:[],_count:{messages:0}};
 const repo:any={getConversationById:async()=>row,listAssignableUsers:async()=>[{id:'admin',name:'Admin',role:'ADMIN'}],setOwner:async(_id:string,owner:string|null)=>{ownerWrites++;row.ownerUserId=owner;},updateTags:async(_id:string,tags:any)=>{tagWrites++;row.memory.tags=tags;}};
 return {row,service:new InboxService(repo),stats:()=>({tagWrites,ownerWrites})};
}
test('controle nunca reativa FINISHED, bloqueado ou entrega incerta',async()=>{
 for(const [state,memory] of [['FINISHED',{}],['BLOCKED',{}],['ASK_EMAIL',{blocked:true}]] as const){const f=fixture(state,memory);assert.equal((await f.service.getDetail('conversation',admin))?.botActive,false);await assert.rejects(f.service.toggleBotControl('conversation','admin',admin),/encerrado ou bloqueado/);assert.equal(f.stats().ownerWrites,0);}
 const uncertain=fixture('MANUAL',{pendingBotReply:{sending:true}},'admin');await assert.rejects(uncertain.service.assignOwner('conversation',null,admin),/Entrega incerta/);assert.equal(uncertain.stats().ownerWrites,0);
});
test('etiquetas são normalizadas; configuração de atendimento preservada',async()=>{
 const f=fixture('ASK_EMAIL',{planId:'click-plan',pendingBotReply:{sending:false},humanTakeover:true});
 await f.service.updateTags('conversation',[{label:' Prioridade ',color:'rose'},{label:'prioridade',color:'sky'}],admin);
 assert.equal(f.row.memory.tags.length,1);assert.equal(f.row.memory.planId,'click-plan');assert.equal(f.row.memory.humanTakeover,true);assert.equal(f.stats().tagWrites,1);
});
test('atribuição de responsável valida usuário e proíbe encaminhamento indevido',async()=>{
 const f=fixture();await assert.rejects(f.service.assignOwner('conversation','unknown',admin),/inválido/);
 await assert.rejects(f.service.assignOwner('conversation','admin',employee),/FORBIDDEN/);
 assert.equal(f.stats().ownerWrites,0);
});
test('campanha oficial normaliza números e rejeita contatos inválidos sem ignorá-los',()=>{
 assert.deepEqual(campaignContacts('(11) 90000-0000;5511900000000\n5511900000001'), ['5511900000000','5511900000001']);
 assert.throws(()=>campaignContacts('inválido'));
 assert.throws(()=>campaignContacts('5511900000000;inválido'));
 assert.throws(()=>campaignContacts(''));
 assert.throws(()=>campaignContacts(Array.from({length:101},(_,i)=>'55119'+String(i).padStart(8,'0')).join('\n')));
});
test('novas abas apontam para adaptadores; não importam automação Alfa',()=>{
 const ui=readFileSync('src/modules/conversas/components/conversation-center.tsx','utf8');
 assert.ok(ui.includes('/api/inbox'));assert.ok(ui.includes('newAgentId'));assert.ok(!ui.includes('Giovana'));
 const route=readFileSync('src/app/api/inbox/route.ts','utf8');assert.ok(route.includes('permissions.conversationsView'));
});

test('devolver conversa em handoff sem responsável libera controle em um clique',async()=>{
 const f=fixture('ASK_EMAIL',{humanTakeover:true});
 await f.service.toggleBotControl('conversation','admin',admin);
 assert.equal(f.row.ownerUserId,null);assert.equal(f.stats().ownerWrites,1);
});

test('lista e detalhe identificam operadora por instância e não pelo nome do bot',async()=>{
 for(const instanceName of ['CLICK','GIGA CLICK']){
  const f=fixture();f.row.agent.zapiInstanceId=instanceName;
  assert.equal((await f.service.getDetail('conversation',admin))?.agent?.instanceName,instanceName);
  const list=new InboxService({listConversations:async()=>[f.row],countConversations:async()=>1} as any);
  assert.equal((await list.list({includeSummary:false,user:admin})).items[0].agent?.instanceName,instanceName);
 }
});
test('destino de envio mantém autorização sem consultar mensagens ou dados privados',async()=>{
 let query:any;const repo=new InboxRepository({chatConversation:{findFirst:async(q:any)=>{query=q;return null;}}} as any);
 await repo.getDeliveryTarget('synthetic',employee);assert.equal(query.where.ownerUserId,employee.id);assert.equal(query.where.agent.zapiInstanceId,'CLICK');assert.deepEqual(query.select,{id:true,phone:true,agentId:true});
});
