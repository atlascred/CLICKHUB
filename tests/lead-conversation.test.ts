import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LeadConversationService} from '../src/modules/leads/services/lead-conversation.service';
const user:any={id:'user',role:'ADMIN',permissions:{}};
function setup({lead:anyLead={name:'Cliente',phone:'(11) 90000-0000'},count=1,conversations=[{id:'vivo',agentId:'agent-vivo',agent:{zapiInstanceId:'GIGA CLICK'}}]}:any={}){
 const queries:any[]=[];const service=new LeadConversationService({findContactById:async(id:any,access:any)=>{queries.push({leadId:id,access});return anyLead;}} as any,{chatConversation:{count:async(q:any)=>{queries.push(q);return count;},findMany:async(q:any)=>{queries.push(q);return conversations;}}} as any);return{service,queries};
}
test('abre conversa vinculada à VIVO sem confundir com NIO ou usar WhatsApp externo',async()=>{
 const f=setup();const r=await f.service.resolve('lead',user);assert.equal(r.status,'success');if(r.status!=='success')return;assert.deepEqual(r.conversations,[{id:'vivo',agentId:'agent-vivo',instanceName:'GIGA CLICK'}]);assert.equal(f.queries[2].where.leadId,'lead');
});
test('contato nas duas operadoras exige escolha e mantém a conversa recente de cada agente',async()=>{
 const f=setup({conversations:[{id:'recent-nio',agentId:'a',agent:{zapiInstanceId:'CLICK'}},{id:'vivo',agentId:'b',agent:{zapiInstanceId:'GIGA CLICK'}},{id:'old-nio',agentId:'a',agent:{zapiInstanceId:'CLICK'}}]});const r=await f.service.resolve('lead',user);if(r.status!=='success')throw Error();assert.deepEqual(r.conversations.map(c=>c.id),['recent-nio','vivo']);
});
test('lead manual sem conversa retorna contato para preencher formulário sem criar ou enviar',async()=>{
 const f=setup({count:0,conversations:[]});const r=await f.service.resolve('lead',user);if(r.status!=='success')throw Error();assert.equal(r.lead.name,'Cliente');assert.deepEqual(r.conversations,[]);assert.equal(f.queries[2].where.leadId,null);assert.ok(f.queries[2].where.phone.in.includes('5511900000000'));
});
test('conversa do contato fora da primeira página é resolvida diretamente por ID',async()=>{
 const f=setup({conversations:[{id:'beyond-page-1',agentId:'a',agent:{zapiInstanceId:'CLICK'}}]});const r=await f.service.resolve('lead',user);if(r.status!=='success')throw Error();assert.equal(r.conversations[0].id,'beyond-page-1');assert.equal(f.queries[2].take,undefined);
});
test('permissões de colaborador e escopo de operadora são preservados',async()=>{
 const employee:any={id:'employee',role:'EMPLOYEE',permissions:{'leads.onlyGiga':true}};const f=setup();await f.service.resolve('lead',employee);assert.equal(f.queries[0].access,employee);assert.equal(f.queries[2].where.ownerUserId,'employee');assert.deepEqual(f.queries[2].where.agent,{zapiInstanceId:'GIGA CLICK'});
});
test('lead inexistente ou conversa sem acesso não cria uma conversa alternativa',async()=>{
 const f=setup({lead:null});assert.equal((await f.service.resolve('missing',user)).status,'not_found');assert.equal(f.queries.length,1);assert.equal((await setup({conversations:[]}).service.resolve('lead',user)).status,'forbidden');
});
