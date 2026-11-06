import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Prisma} from '@prisma/client';
import {DispatchConversationsService} from '../src/modules/envio-em-massa/services/dispatch-conversations.service';
import {MetaRequestError} from '../src/modules/envio-em-massa/services/official-meta.service';
import {dispatchScope,dispatchThreadId,serviceWindowOpen,metaEventDate} from '../src/modules/envio-em-massa/lib/dispatch-policy';
import {buildConversationAccessWhere} from '../src/repositories/inbox.repository';
import {createHmac} from 'node:crypto';
const phone='5511900000000',phoneId='123';
function fixture(){
 const threads=new Map<string,any>(),messages=new Map<string,any>();
 function match(item:any,where:any):boolean {if(!item)return false;for(const [key,value]of Object.entries(where||{})){if(key==='conversation'){if(!match(threads.get(item.conversationId),value))return false;}else if(key==='rawPayload'){const rule=value as any;if(rule.path){if(item.rawPayload?.[rule.path[0]]!==rule.equals)return false;}else if(JSON.stringify(item.rawPayload)!==JSON.stringify(rule.equals))return false;}else if(key==='memory'){const v=value as any;if(item.memory?.[v.path[0]]!==v.equals)return false;}else if(key==='state'&&typeof value==='object'){if(!item.state.startsWith((value as any).startsWith))return false;}else if(item[key]!==value)return false;}return true;}
 const db:any={chatConversation:{upsert:async({where,create,update}:any)=>{const value=threads.has(where.id)?{...threads.get(where.id),...update}:{deletedAt:null,ownerUserId:null,...create};threads.set(where.id,value);return value;},findFirst:async({where}:any)=>[...threads.values()].find(item=>match(item,where))||null,findMany:async({where}:any)=>[...threads.values()].filter(item=>match(item,{...where,id:undefined})),update:async({where,data}:any)=>{Object.assign(threads.get(where.id),data);return threads.get(where.id);}},chatMessage:{create:async({data}:any)=>{if([...messages.values()].some(item=>item.providerId===data.providerId))throw new Prisma.PrismaClientKnownRequestError('duplicate',{code:'P2002',clientVersion:'test'});const item={createdAt:new Date(),...structuredClone(data)};messages.set(item.id,item);return item;},findUnique:async({where}:any)=>[...messages.values()].find(item=>match(item,where))||null,findUniqueOrThrow:async({where}:any)=>{const value=[...messages.values()].find(item=>match(item,where));if(!value)throw Error('Missing message');return structuredClone(value);},findFirst:async({where}:any)=>[...messages.values()].filter(item=>match(item,where)).sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime())[0]||null,update:async({where,data}:any)=>{const item=messages.get(where.id);Object.assign(item,structuredClone(data));return item;},updateMany:async({where,data}:any)=>{const item=[...messages.values()].find(item=>match(item,where));if(!item)return{count:0};Object.assign(item,structuredClone(data));return{count:1};}}};db.$transaction=async(fn:any)=>fn(db);
 let calls=0;const meta:any={sendContent:async()=>{calls++;return 'wamid.test';},upload:async()=> '456'};const service=new DispatchConversationsService(db,meta);
 return {db,service,meta,threads,messages,calls:()=>calls};
}
async function inbound(f:ReturnType<typeof fixture>,timestamp=Date.now(),id='in-1'){await f.service.receive({id,from:phone,type:'text',text:{body:'Olá'},timestamp:String(Math.floor(timestamp/1000))},[{wa_id:phone,profile:{name:'Contato Sintético'}}],phoneId);return dispatchThreadId(phoneId,phone);}
test('caixa Meta e bots Evolution possuem filtros de isolamento distintos',()=>{
 assert.equal(dispatchScope().agentId,null);assert.deepEqual(dispatchScope().state,{startsWith:'DISPATCH_'});assert.deepEqual(dispatchScope({id:'employee',role:'EMPLOYEE'}).ownerUserId,'employee');assert.deepEqual(buildConversationAccessWhere().NOT,{state:{startsWith:'DISPATCH_'}});
 assert.notEqual(dispatchThreadId('123',phone),dispatchThreadId('456',phone));assert.equal(dispatchThreadId('123',phone),dispatchThreadId('123',phone));
});
test('janela usa data real da mensagem e fecha após 24 horas',()=>{
 const now=Date.now();assert.equal(serviceWindowOpen(now-1000 as any,now),true);assert.equal(serviceWindowOpen(new Date(now-86400000),now),false);assert.equal(serviceWindowOpen(new Date(now+3600000),now),false);assert.equal(metaEventDate('invalid').getTime(),0);
});
test('webhook duplicado não duplica mensagem nem reabre bloqueio',async()=>{
 const f=fixture(),id=await inbound(f);f.threads.get(id).state='DISPATCH_BLOCKED';await inbound(f);assert.equal(f.messages.size,1);assert.equal(f.threads.get(id).state,'DISPATCH_BLOCKED');assert.equal(f.threads.get(id).agentId,null);assert.equal(f.calls(),0);
});
test('envio repetido com mesma chave não chama Meta novamente',async()=>{
 const f=fixture(),threadId=await inbound(f);const input={threadId,requestId:'request-1',body:'Resposta sintética'};assert.equal(await f.service.send(input),'wamid.test');assert.equal(await f.service.send(input),'wamid.test');assert.equal(f.calls(),1);assert.equal([...f.messages.values()].filter(m=>m.direction==='outbound').length,1);
});
test('janela fechada e contato bloqueado impedem chamada externa',async()=>{
 const f=fixture(),threadId=await inbound(f,Date.now()-86401000);await assert.rejects(f.service.send({threadId,requestId:'closed',body:'Teste'}),/24 horas/);assert.equal(f.calls(),0);f.threads.get(threadId).state='DISPATCH_BLOCKED';await assert.rejects(f.service.send({threadId,requestId:'blocked',body:'Teste'}),/bloqueado/);assert.equal(f.calls(),0);
});
test('timeout preserva tentativa incerta e nunca reenvia automaticamente',async()=>{
 const f=fixture(),threadId=await inbound(f);let calls=0;f.meta.sendContent=async()=>{calls++;throw new MetaRequestError('Sem confirmação',true);};const input={threadId,requestId:'uncertain',body:'Resposta'};await assert.rejects(f.service.send(input),/Sem confirmação/);await assert.rejects(f.service.send(input),/sem confirmação/);assert.equal(calls,1);assert.equal([...f.messages.values()].find(m=>m.direction==='outbound').rawPayload.state,'uncertain');
});
test('leitura recebida antes do retorno HTTP não é rebaixada',async()=>{
 const f=fixture(),threadId=await inbound(f);const previous=process.env.META_WHATSAPP_PHONE_NUMBER_ID;process.env.META_WHATSAPP_PHONE_NUMBER_ID=phoneId;
 try{f.meta.sendContent=async(_phone:string,payload:any)=>{await f.service.status({id:'wamid.early',status:'read',timestamp:String(Math.floor(Date.now()/1000)),biz_opaque_callback_data:payload.biz_opaque_callback_data},phoneId);return 'wamid.early';};await f.service.send({threadId,requestId:'early',body:'Resposta'});const message=[...f.messages.values()].find(m=>m.direction==='outbound');assert.equal(message.rawPayload.state,'read');await f.service.status({id:'wamid.early',status:'delivered'},phoneId);await f.service.status({id:'wamid.early',status:'failed'},phoneId);assert.equal(message.rawPayload.state,'read');}finally{if(previous===undefined)delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;else process.env.META_WHATSAPP_PHONE_NUMBER_ID=previous;}
});
test('webhook oficial percorre todos os contatos e ignora outro número/WABA',async()=>{
 const {POST}=require('../src/app/api/whatsapp/meta/webhook/route');const {dispatchConversations}=require('../src/modules/envio-em-massa/services/dispatch-conversations.service');const previous={receive:dispatchConversations.receive,status:dispatchConversations.status};const keys=['META_WHATSAPP_APP_SECRET','META_WHATSAPP_BUSINESS_ACCOUNT_ID','META_WHATSAPP_PHONE_NUMBER_ID'],saved=keys.map(k=>process.env[k]);const calls:string[]=[];
 try{process.env.META_WHATSAPP_APP_SECRET='fixture';process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID='account';process.env.META_WHATSAPP_PHONE_NUMBER_ID=phoneId;dispatchConversations.receive=async(m:any)=>{calls.push(m.id);};dispatchConversations.status=async()=>{};
 const change=(number:string,ids:string[])=>({field:'messages',value:{metadata:{phone_number_id:number},messages:ids.map(id=>({id}))}});const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'other',changes:[change(phoneId,['wrong-account'])]},{id:'account',changes:[change('other',['wrong-number']),change(phoneId,['first','second']),change(phoneId,['third'])]}]});const response=await POST(new Request('https://example.test',{method:'POST',body:raw,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','fixture').update(raw).digest('hex')}}));assert.equal(response.status,200);assert.deepEqual(calls,['first','second','third']);
 }finally{Object.assign(dispatchConversations,previous);keys.forEach((key,i)=>{if(saved[i]===undefined)delete process.env[key];else process.env[key]=saved[i];});}
});
