import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { DispatchChatbotService } from '../src/modules/envio-em-massa/services/dispatch-chatbot.service';
import { DispatchConversationsService } from '../src/modules/envio-em-massa/services/dispatch-conversations.service';
import { setDispatchBotPaused } from '../src/modules/envio-em-massa/services/dispatch-bot-control';
import { commercialPlans } from '../scripts/lib/commercial-plans';
const phone='5511900000000',phoneId='123';
const copy=<T>(v:T):T=>structuredClone(v);
function fixture(){
 const threads:any[]=[],messages:any[]=[],leads:any[]=[],settings=new Map<string,any>(),sends:string[]=[];
 let failSend=false;
 function match(item:any,where:any={}):boolean{if(!item)return false;return Object.entries(where).every(([key,value]:any)=>{
   if(key==='OR')return value.some((x:any)=>match(item,x));
   if(key==='NOT')return !match(item,value);
   if(key==='memory'||key==='rawPayload'){if(value.path){const data=item[key]?.[value.path[0]];return value.array_contains?value.array_contains.every((v:any)=>data?.includes(v)):data===value.equals;}return JSON.stringify(item[key])===JSON.stringify(value.equals);}
   if(key==='state'&&typeof value==='object')return item.state.startsWith(value.startsWith);
   return item[key]===value;
 });}
 const db:any={chatConversation:{
  findFirst:async({where,include}:any)=>{const item=threads.find(t=>match(t,where));return item?copy({...item,...(include?{messages:messages.filter(m=>m.conversationId===item.id).slice(-10).reverse()}:{} )}):null;},
  findUnique:async({where}:any)=>copy(threads.find(t=>match(t,where))||null),
  upsert:async({where,create,update}:any)=>{let t=threads.find(t=>match(t,where));if(t)Object.assign(t,copy(update));else{t={deletedAt:null,ownerUserId:null,...copy(create)};threads.push(t);}return copy(t);},
  update:async({where,data}:any)=>{const t=threads.find(t=>match(t,where));Object.assign(t,copy(data));return copy(t);},
  updateMany:async({where,data}:any)=>{let count=0;for(const t of threads)if(match(t,where)){Object.assign(t,copy(data));count++;}return {count};},
 },chatMessage:{
  create:async({data}:any)=>{if(data.providerId&&messages.some(m=>m.providerId===data.providerId))throw new Prisma.PrismaClientKnownRequestError('duplicate',{code:'P2002',clientVersion:'test'});const m={id:randomUUID(),createdAt:new Date(),...copy(data)};messages.push(m);return copy(m);},
  findFirst:async({where,orderBy}:any)=>{const found=messages.filter(m=>match(m,where));return copy((orderBy?found.sort((a,b)=>+b.createdAt-+a.createdAt):found)[0]||null);},
  findUnique:async({where}:any)=>copy(messages.find(m=>match(m,where))||null),
  findUniqueOrThrow:async({where}:any)=>{const m=messages.find(m=>match(m,where));if(!m)throw Error('missing');return copy(m);},
  update:async({where,data}:any)=>{const m=messages.find(m=>match(m,where));Object.assign(m,copy(data));return copy(m);},
  updateMany:async({where,data}:any)=>{let count=0;for(const m of messages)if(match(m,where)){Object.assign(m,copy(data));count++;}return {count};},
 },agent:{findMany:async({where}:any)=>{assert.equal(where.zapiInstanceId,'CLICK');return [{id:'nio-agent',name:'Lily',zapiInstanceId:'CLICK',plans:commercialPlans.map((p,i)=>({...p,id:'plan-'+i})),enableTyping:false,enableReplyDelay:false}];}},
 lead:{create:async({data}:any)=>{const l={id:randomUUID(),...copy(data)};leads.push(l);return copy(l);},findUnique:async({where}:any)=>leads.find(l=>l.id===where.id),update:async({where,data}:any)=>{const l=leads.find(l=>l.id===where.id);Object.assign(l,copy(data));return copy(l);}},
 appSetting:{findUnique:async({where}:any)=>settings.get(where.key),upsert:async({where,create,update}:any)=>{const r=settings.has(where.key)?update:create;settings.set(where.key,r);return r;}},$queryRaw:async()=>[],};db.$transaction=async(fn:any)=>fn(db);
 const dispatch=new DispatchConversationsService(db,{sendContent:async(_phone:string,content:any)=>{if(failSend)throw Error('timeout');sends.push(content.text.body);return 'wamid.'+sends.length;}} as any);
 // Queue mechanics already have concurrency tests; this adapter tests the real NIO engine.
 const batch:any={accept:async(_scope:string,message:any,run:any)=>run([message])};
 const service=new DispatchChatbotService(db,dispatch,batch,{interpretConversation:async()=>null,answerCommercialQuestion:async()=>''} as any,{findByCep:async()=>({available:true,street:'Rua Simulada',neighborhood:'Centro',city:'Cidade Teste',state:'SP'})} as any);
 let seq=0;
 async function say(body:string,id='in-'+(++seq),age=0,type='text') {const m={id,from:phone,type,text:{body},timestamp:String(Math.floor((Date.now()-age)/1000))};await dispatch.receive(m,[],phoneId);return service.process(m,phoneId);}
 return {db,dispatch,service,threads,messages,leads,sends,say,setFail:(v:boolean)=>{failSend=v;}};
}
function cpf(){const a=[9,8,7,6,5,4,3,2,0];for(const factor of [10,11]){const mod=a.reduce((s,d,i)=>s+d*(factor-i),0)*10%11;a.push(mod===10?0:mod);}return a.join('');}
for(const [choice,value]of [['1',55],['2',70],['3',85]] as const)test(`API oficial reutiliza contratação NIO completa, plano ${value}, sem Evolution`,async()=>{
 const f=fixture();await f.say('oi');assert.equal(f.threads[0].memory.nioBotState,'ASK_CEP');await f.say('01001000');await f.say('123');await f.say('não');const menu=f.sends.at(-1)!;assert.ok(menu.includes('55,00'));assert.ok(menu.includes('70,00'));assert.ok(menu.includes('85,00'));
 await f.say(choice);if(f.threads[0].memory.nioBotMemory.pendingUpsellPlanId)await f.say('não');await f.say('Cliente Simulado');assert.equal(f.threads[0].memory.nioBotState,'ASK_MOTHER_NAME');await f.say('Maria Simulada');await f.say(cpf());await f.say('01/01/1995');assert.equal(f.threads[0].memory.nioBotState,'ASK_EMAIL');await f.say('não sei meu email');assert.equal(f.threads[0].memory.nioBotState,'ASK_BILLING_DUE_DAY');await f.say('10');assert.equal(f.leads.length,0);await f.say('sim');assert.equal(f.threads[0].memory.nioBotState,'FINISHED');assert.equal(f.leads.length,1);assert.equal(f.leads[0].expectedValue,value);assert.equal(f.leads[0].source,'chatbot:click');assert.equal(f.leads[0].motherName,'Maria Simulada');assert.equal(f.leads[0].email,'não sei meu email');assert.equal(f.threads[0].agentId,null);assert.equal(f.threads[0].state,'DISPATCH_OPEN');assert.equal(f.threads[0].leadId,f.leads[0].id);assert.equal(f.messages.filter(m=>m.direction==='outbound').length,f.sends.length);const n=f.sends.length;await f.say('sim','confirmation-repeat');assert.equal(f.sends.length,n);
});
test('reentrega não duplica resposta; pausado, bloqueado, finalizado e reação não iniciam bot',async()=>{
 const f=fixture();await f.say('oi','duplicate');await f.say('oi','duplicate');assert.equal(f.sends.length,1);const t=f.threads[0];await setDispatchBotPaused(f.db,t.id,true);await f.say('01001000');assert.equal(f.sends.length,1);await setDispatchBotPaused(f.db,t.id,false);await f.say('01001000');assert.equal(t.memory.nioBotState,'ASK_STREET_NUMBER');assert.equal(f.sends.length,2);t.state='DISPATCH_BLOCKED';await f.say('123');assert.equal(f.sends.length,2);t.state='DISPATCH_OPEN';await f.say('❤','reaction',0,'reaction');assert.equal(f.sends.length,2);await f.say('123','stale',86401000);assert.equal(f.sends.length,2);
});
test('solicitação de atendente pausa a automação e preserva a etapa',async()=>{
 const f=fixture();await f.say('oi');await f.say('quero falar com atendente');assert.equal(f.threads[0].memory.nioBotMemory.humanTakeover,true);const count=f.sends.length;await f.say('01001000');assert.equal(f.sends.length,count);await setDispatchBotPaused(f.db,f.threads[0].id,false);await f.say('01001000');assert.equal(f.threads[0].memory.nioBotState,'ASK_STREET_NUMBER');
});
test('falha de envio exige revisão e reentrega nunca repete envio incerto',async()=>{
 const f=fixture();f.setFail(true);await assert.rejects(f.say('oi','failure'),/timeout/);assert.equal(f.threads[0].memory.nioBotMemory.humanTakeover,true);f.setFail(false);await f.say('oi','failure');assert.equal(f.sends.length,0);
});
test('resposta enviada com estado pendente recupera finalização sem novo envio',async()=>{
 const f=fixture();await f.say('oi','recovery');const t=f.threads[0];t.memory.nioBotMemory={pendingBotReply:{providerId:`meta:${phoneId}:recovery`,next:{state:'ASK_CEP',memory:{whatsapp:phone}}}};t.memory.nioBotState='START';await f.say('oi','recovery');assert.equal(f.sends.length,1);assert.equal(t.memory.nioBotState,'ASK_CEP');
});
test('etiquetas, responsável e origem oficial sobrevivem às etapas e ao reinício do bot',async()=>{
 const f=fixture();await f.say('oi');const t=f.threads[0];t.ownerUserId='operator';t.memory.dispatchTagIds=['interessado'];await f.say('recomeçar');assert.equal(t.ownerUserId,'operator');assert.deepEqual(t.memory.dispatchTagIds,['interessado']);assert.equal(t.memory.source,'meta-dispatch');assert.equal(t.agentId,null);
});
test('agente NIO indisponível falha sem usar agente padrão ou VIVO',async()=>{
 const f=fixture();f.db.agent.findMany=async()=>[];await assert.rejects(f.say('oi'),/exatamente um agente ativo/);assert.equal(f.sends.length,0);
});
test('retomar não desbloqueia contatos nem apaga dados já coletados',async()=>{
 const f=fixture();await f.say('oi');const t=f.threads[0];t.memory.nioBotMemory.cep='01001000';await setDispatchBotPaused(f.db,t.id,true);await setDispatchBotPaused(f.db,t.id,false);assert.equal(t.memory.nioBotMemory.cep,'01001000');t.state='DISPATCH_BLOCKED';await assert.rejects(setDispatchBotPaused(f.db,t.id,false),/desbloqueie/);assert.equal(t.state,'DISPATCH_BLOCKED');
});
