import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchApi, ApiRequestError } from '../src/lib/client-api';
import { safeRedirectPath } from '../src/lib/safe-redirect';
import { businessDate } from '../src/lib/business-date';
import { clearSentDraft, mergeRecentMessages } from '../src/modules/conversas/conversation-state';
import { FollowUpRepository } from '../src/repositories/follow-up.repository';

test('requisições preservam JSON, aceitam 204 e propagam erros do servidor', async () => {
 global.fetch = async () => new Response(JSON.stringify({status:'success',data:[1]}));
 assert.deepEqual(await (await fetchApi('/fixture')).json(),{status:'success',data:[1]});
 global.fetch = async () => new Response(null,{status:204});
 assert.equal((await fetchApi('/fixture')).status,204);
 global.fetch = async () => new Response(JSON.stringify({status:'error',message:'Acesso negado'}),{status:403});
 await assert.rejects(fetchApi('/fixture'),(e:any)=>e instanceof ApiRequestError && e.status===403 && e.message==='Acesso negado');
});
test('resposta HTML, resposta vazia e falha de rede encerram a operação com erro legível', async () => {
 for(const response of [new Response('<html>proxy</html>',{status:502}),new Response('')]){
  global.fetch=async()=>response;await assert.rejects(fetchApi('/fixture'),ApiRequestError);
 }
 let calls=0;global.fetch=async()=>{calls++;throw new TypeError('network');};
 await assert.rejects(fetchApi('/fixture',{method:'POST'}),/conexão/);assert.equal(calls,1);
});
test('timeout de envio não repete a escrita e cancelamento externo é preservado',async()=>{
 let calls=0;global.fetch=async(_input,init)=>{calls++;return new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));};
 await assert.rejects(fetchApi('/fixture',{method:'POST'},10),/demorou/);assert.equal(calls,1);
 const controller=new AbortController();const pending=fetchApi('/fixture',{signal:controller.signal},1000);controller.abort();
 await assert.rejects(pending,(e:any)=>e.name==='AbortError');
});
test('timeout também cobre corpo de resposta interrompido',async()=>{
 global.fetch=async(_input,init)=>({ok:true,status:200,text:()=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))}) as Response;
 await assert.rejects(fetchApi('/fixture',{},10),/demorou/);
});
test('rascunho novo e anexo novo sobrevivem ao término de um envio anterior',()=>{
 const original={name:'old'},next={name:'new'};
 assert.deepEqual(clearSentDraft({message:'nova mensagem',file:next},{message:'enviada',file:original}),{message:'nova mensagem',file:next});
 assert.deepEqual(clearSentDraft({message:'enviada',file:original},{message:'enviada',file:original}),{message:'',file:null});
 assert.equal(clearSentDraft({message:'legenda',file:original},{message:'legenda',file:original},true).message,'legenda');
});
test('atualização recente mantém histórico carregado, ordena e atualiza IDs existentes',()=>{
 const merged=mergeRecentMessages([{id:'old',createdAt:'2026-11-04',body:'antiga'},{id:'new',createdAt:'2026-11-05',body:'antes'}],[{id:'new',createdAt:'2026-11-05',body:'depois'},{id:'latest',createdAt:'2026-11-06',body:'nova'}]);
 assert.deepEqual(merged.map(m=>m.id),['old','new','latest']);assert.equal(merged[1].body,'depois');
});
test('redirecionamento do login aceita apenas caminhos internos',()=>{
 for(const value of ['//evil.invalid','https://evil.invalid','javascript:alert(1)','/\\evil.invalid',null])assert.equal(safeRedirectPath(value,'/leads'),'/leads');
 assert.equal(safeRedirectPath('/conversas?lead=synthetic#chat','/leads'),'/conversas?lead=synthetic#chat');
});
test('filtro Hoje respeita meia-noite brasileira e datas sem horário',()=>{
 assert.equal(businessDate('2026-11-05T02:59:59Z'),'2026-11-04');assert.equal(businessDate('2026-11-05T03:00:00Z'),'2026-11-05');assert.equal(businessDate('2026-11-05'),'2026-11-05');assert.equal(businessDate('invalid'),'');
});
test('follow-up só recupera reserva cancelada antes do envio e mantém reserva atômica',async()=>{
 for(const status of ['cancelled','claimed','sending','sent','review_required']){
  const db={appSetting:{create:async()=>{throw Object.assign(new Error('duplicate'),{code:'P2002'});},updateMany:async(query:any)=>{assert.equal(query.where.value.equals,'cancelled');assert.equal(query.where.key,'synthetic');assert.equal(query.data.value.status,'claimed');return{count:status==='cancelled'?1:0};}}};
  assert.equal(await new FollowUpRepository(db as any).claim('synthetic','conversation','ASK_EMAIL',new Date()),status==='cancelled');
 }
});

test('rotas antigas mantêm escopo do atendente e não consultam tokens ou senhas',async()=>{
 const {ChatbotRepository}=require('../src/repositories/chatbot.repository');
 const user={id:'synthetic-user',role:'EMPLOYEE',permissions:{}};
 const inspect=async(query:any)=>{assert.equal(query.where.ownerUserId,user.id);assert.equal(query.where.deletedAt,null);assert.equal(query.include.agent.select.zapiToken,undefined);assert.equal(query.include.owner.select.passwordHash,undefined);return null;};
 const repository=new ChatbotRepository({chatConversation:{findFirst:inspect,findMany:inspect}});
 await repository.findConversationById('synthetic-conversation',user);await repository.listConversations(undefined,user);
});
test('conversa inacessível é recusada antes de atualização ou exclusão',async()=>{
 const {ConversationService}=require('../src/modules/chatbot/services/conversation.service');let writes=0;
 const service=new ConversationService({findConversationById:async()=>null,updateManualConversation:async()=>writes++,softDeleteConversation:async()=>writes++});
 await assert.rejects(service.update({id:'synthetic'}),/FORBIDDEN/);await assert.rejects(service.delete('synthetic'),/FORBIDDEN/);assert.equal(writes,0);
});
