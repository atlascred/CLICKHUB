import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveEvolutionOutbound } from '../src/repositories/evolution-outbound.repository';
import { ChatbotRepository } from '../src/repositories/chatbot.repository';
import { scopedEvolutionId } from '../src/services/evolution-context';
import * as evolution from '../src/services/evolution';
import { parseEvolutionWebhookPayload } from '../src/services/evolution';

const Module = require('node:module'), original = Module._load;
const agents = { CLICK: { id: 'agent-a', zapiInstanceId: 'CLICK' }, 'GIGA CLICK': { id: 'agent-b', zapiInstanceId: 'GIGA CLICK' } };
let conversations: any[] = [], messages: any[] = [], sql: any[] = [], fail = false, sequence = 0;
const db: any = {
  chatConversation: {
    findFirst: async ({where}: any) => conversations.find(c => (!where.id || c.id === where.id) && (!where.phone || c.phone === where.phone) && (!where.agentId || c.agentId === where.agentId) && !c.deletedAt) ?? null,
    create: async ({data}: any) => { const value = { id: `conversation-${++sequence}`, ...data }; conversations.push(value); return value; },
    update: async ({where,data}: any) => { const c = conversations.find(c=>c.id===where.id); Object.assign(c,data); return c; },
  },
  chatMessage: {
    findFirst: async ({where}: any) => messages.find(m => where.providerId.in.includes(m.providerId) && conversations.find(c => c.id===m.conversationId)?.agentId===where.conversation.agentId) ?? null,
    create: async ({data}: any) => { assert.equal(messages.some(m=>m.providerId===data.providerId),false); const m={id:`message-${++sequence}`,...data};messages.push(m);return m; },
  },
  $queryRaw: async (parts: any,...values: any[]) => { sql.push({query:parts.join('?'),values}); },
  $executeRaw: async (parts: any,...values: any[]) => { sql.push({query:parts.join('?'),values}); const m=messages.find(m=>m.id===values.at(-1)); if(m) m.rawPayload={...m.rawPayload,...JSON.parse(values[0])};return 1; },
};
let tail = Promise.resolve();
db.$transaction = (run: any) => { const promise=tail.then(()=>{if(fail)throw Error('Database unavailable');return run(db);});tail=promise.catch(()=>{});return promise; };
let echoBeforeReceipt = false;
Module._load=function(name:string,...args:any[]) {
 if(name==='@/lib/auth-context')return {requireCurrentUser:async()=>({id:'fixture-owner',role:'ADMIN'})};
 if(name==='@/lib/permissions')return {assertPermission:()=>{}};
 if(name==='@/services/whatsapp-agent')return {resolveSelectedAgent:async()=>agents.CLICK};
 if(name==='@/services/evolution')return {...evolution,resolveEvolutionPhone:async(phone:string)=>({phone}),sendEvolutionTextMessage:async()=>{if(echoBeforeReceipt)assert.equal((await send(payload('crm-http'))).status,200);return {key:{id:'crm-http',fromMe:true}};}};
 if(name==='@/lib/prisma')return {prisma:db};
 if(name==='@/repositories/chatbot.repository')return {ChatbotRepository:class{async getAgentByInstance(name:keyof typeof agents){return agents[name];}}};
 if(name==='@/modules/chatbot/services/chatbot-engine.service')return {ChatbotEngineService:class{async processIncomingMessage(){throw Error('Outbound must never run the bot');}}};
 if(name==='@/modules/chatbot/services/message-batch.service')return {MessageBatchService:class{async accept(){throw Error('Outbound must never enter the batch');}}};
 if(name==='@/services/openai/openai.service')return {OpenAiService:class{async transcribeAudio(){throw Error('Outbound must never run AI');}}};
 if(name==='@/lib/logger')return {writeTechnicalLog:async()=>{}};
 return original.call(this,name,...args);
};
const {handleEvolutionWebhook}=require('../src/app/api/whatsapp/webhook/handler');
const {POST:sendFromCrm}=require('../src/app/api/whatsapp/send/route');
Module._load=original;
delete process.env.EVOLUTION_INSTANCE;
process.env.EVOLUTION_INSTANCES_JSON=JSON.stringify(Object.keys(agents).map(instanceName=>({instanceName,apiUrl:'https://fixture.invalid',apiKey:'synthetic-secret',number:'5511900000001'})));
const phone='5511900000002';
function payload(id:string, instance='CLICK', message:any={conversation:'Texto fictício'}) {return {event:'messages.upsert',instance,apikey:'synthetic-secret',data:{key:{id,fromMe:true,remoteJid:phone+'@s.whatsapp.net'},pushName:'Nome do dono do celular',message,messageTimestamp:Math.floor(Date.now()/1000)-30}};}
function send(body:any) {return handleEvolutionWebhook(new Request('https://fixture.invalid/api/whatsapp/webhook',{method:'POST',body:JSON.stringify(body)}));}
function reset() {conversations=[];messages=[];sql=[];fail=false;}

test('mensagem própria é armazenada como saída, com horário original, sem chamar bot ou IA',async()=>{
 reset();const body=payload('phone-1');const response=await send(body);assert.equal(response.status,200);assert.equal(messages.length,1);assert.equal(messages[0].direction,'outbound');assert.equal(messages[0].body,'Texto fictício');assert.equal(messages[0].createdAt.getTime(),body.data.messageTimestamp*1000);assert.equal(conversations[0].agentId,'agent-a');assert.equal(conversations[0].state,'MANUAL');assert.equal(conversations[0].memory.contactName,phone);assert.ok(!JSON.stringify(messages[0].rawPayload).includes('synthetic-secret'));
});
test('retries simultâneos não duplicam nem alteram estado, responsável ou memória',async()=>{
 reset();conversations.push({id:'existing',phone,agentId:'agent-a',state:'ASK_EMAIL',ownerUserId:'owner',memory:{humanTakeover:true,custom:'preservado'}});const before=structuredClone(conversations[0]);await Promise.all([send(payload('repeat')),send(payload('repeat'))]);assert.equal(messages.length,1);assert.equal(conversations.length,1);for(const key of ['state','ownerUserId','memory'])assert.deepEqual(conversations[0][key],before[key]);
});
test('áudio, imagem e documento próprios preservam envelope e anexo sem transcrição',async()=>{
 reset();for(const type of ['audioMessage','imageMessage','documentMessage']){assert.equal((await send(payload(type,'CLICK',{[type]:{url:'https://files.invalid/a.enc',mediaKey:'synthetic',mimetype:type==='audioMessage'?'audio/ogg':type==='imageMessage'?'image/jpeg':'application/pdf'}}))).status,200);}
 assert.equal(messages.length,3);assert.deepEqual(messages.map(m=>m.rawPayload.kind),['audio','imagem','documento']);assert.ok(messages.every(m=>m.rawPayload.raw.data.message));
});
test('mesmo ID e telefone em agentes diferentes ficam isolados',async()=>{
 reset();await send(payload('shared','CLICK'));await send(payload('shared','GIGA CLICK'));assert.equal(messages.length,2);assert.equal(conversations.length,2);assert.notEqual(messages[0].providerId,messages[1].providerId);assert.notEqual(messages[0].conversationId,messages[1].conversationId);
});
test('eco antes do recibo do bot é mesclado sem perder mídia, status nem inReplyTo',async()=>{
 reset();await send(payload('bot-result'));const m=messages[0];m.rawPayload.status='lido';const repo=new ChatbotRepository(db);await repo.saveMessage({conversationId:m.conversationId,direction:'outbound',body:m.body,providerId:m.providerId,rawPayload:{provider:'evolution',instanceName:'CLICK',providerMessageId:'bot-result',inReplyTo:['inbound-1']}});assert.equal(messages.length,1);assert.deepEqual(m.rawPayload.inReplyTo,['inbound-1']);assert.equal(m.rawPayload.status,'lido');assert.ok(m.rawPayload.raw);await send(payload('bot-result'));assert.equal(messages.length,1);assert.deepEqual(m.rawPayload.inReplyTo,['inbound-1']);assert.ok(sql.some(s=>s.query.includes('COALESCE("rawPayload"')));
});
test('recibo do CRM antes do eco mantém envio único e anexo original',async()=>{
 reset();conversations.push({id:'crm-conversation',phone,agentId:'agent-a',state:'MANUAL',memory:{tags:['Equipe']}});await saveEvolutionOutbound(db,{conversationId:'crm-conversation',instanceName:'CLICK',messageId:'crm-send',body:'Texto fictício',rawPayload:{provider:'evolution',media:{source:'data:image/png;base64,c3ludGhldGlj'}}});await send(payload('crm-send'));assert.equal(messages.length,1);assert.ok(messages[0].rawPayload.media);assert.equal(messages[0].providerId,scopedEvolutionId('CLICK','crm-send'));
});
test('grupos, status, número da instância e eventos sem conteúdo não criam contatos',async()=>{
 reset();for(const remote of ['120000000000@g.us','status@broadcast','12345@newsletter','5511900000001@s.whatsapp.net']) {const body=payload('ignored');body.data.key.remoteJid=remote;assert.equal((await send(body)).status,200);}assert.equal((await send(payload('empty','CLICK',{protocolMessage:{type:0}}))).status,200);assert.equal(messages.length,0);assert.equal(conversations.length,0);
});
test('destino LID usa remoteJidAlt e nunca o remetente da instância',()=>{
 const body:any=payload('lid');body.data.key.remoteJid='123456789012345@lid';body.data.key.remoteJidAlt=phone+'@s.whatsapp.net';body.sender='5511900000001@s.whatsapp.net';assert.equal(parseEvolutionWebhookPayload(body).phone,phone);delete body.data.key.remoteJidAlt;assert.equal(parseEvolutionWebhookPayload(body).phone,'');
});
test('ID ausente usa hash estável e erro de gravação permite retry',async()=>{
 reset();const body:any=payload('missing');delete body.data.key.id;assert.equal((await send(body)).status,200);assert.equal((await send(body)).status,200);assert.equal(messages.length,1);fail=true;assert.equal((await send(payload('retry-later'))).status,500);fail=false;assert.equal((await send(payload('retry-later'))).status,200);assert.equal(messages.length,2);
});
test('evento SEND_MESSAGE também sincroniza o mesmo registro',async()=>{
 reset();const body=payload('send-event');body.event='SEND_MESSAGE';await send(body);await send(payload('send-event'));assert.equal(messages.length,1);
});

test('envio HTTP do CRM tem sucesso mesmo com eco antes da resposta da Evolution',async()=>{
 reset();echoBeforeReceipt=true;
 try {
   const response=await sendFromCrm(new Request('https://fixture.invalid/api/whatsapp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:phone,agentId:'agent-a',message:'Texto fictício'})}));
   assert.equal(response.status,200);assert.equal(messages.length,1);assert.equal(conversations.length,1);assert.equal(messages[0].providerId,scopedEvolutionId('CLICK','crm-http'));assert.ok(messages[0].rawPayload.result);assert.ok(messages[0].rawPayload.raw);
 } finally {echoBeforeReceipt=false;}
});
