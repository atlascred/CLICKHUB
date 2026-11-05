import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFollowUp, FOLLOW_UP_INTERVAL_MS as interval, type FollowUpConversation, type FollowUpSettings } from '../src/modules/chatbot/follow-up';
import { FollowUpService } from '../src/modules/chatbot/services/follow-up.service';
const start=new Date('2026-11-04T12:00:00Z');
const settings:FollowUpSettings={enabled:true,instances:['CLICK','GIGA CLICK'],activatedAt:start.toISOString()};
const message=(id:string,direction:string,at:Date,rawPayload:any={},body='Olá')=>({id,direction,body,createdAt:at,rawPayload});
function fixture():FollowUpConversation{return{id:'conversation',phone:'5511900000000',state:'ASK_EMAIL',memory:{name:'Cliente Sintético',cpfCnpj:'synthetic',planId:'plan'},ownerUserId:null,updatedAt:start,agent:{id:'agent',active:true,deletedAt:null,zapiInstanceId:'CLICK'},messages:[message('bot','outbound',start,{inReplyTo:['inbound']}),message('inbound','inbound',new Date(start.getTime()-1000))]};}
const at=(hours:number)=>new Date(start.getTime()+hours*interval/2);
function reminder(stage:number,hours:number){return message('follow-'+stage,'outbound',at(hours),{followUp:true,followUpAnchor:'bot',followUpStage:stage});}

test('lembretes em 2, 4 e 6 horas, sem encerrar ou reiniciar a etapa',()=>{
 const c=fixture(),before=structuredClone(c);assert.equal(nextFollowUp(c,settings,at(1.99)),null);
 assert.equal(nextFollowUp(c,settings,at(2))?.stage,1);assert.match(nextFollowUp(c,settings,at(2))!.body,/e-mail/);
 c.messages.unshift(reminder(1,2));assert.equal(nextFollowUp(c,settings,at(3.99)),null);assert.equal(nextFollowUp(c,settings,at(4))?.stage,2);
 c.messages.unshift(reminder(2,4));assert.equal(nextFollowUp(c,settings,at(6))?.stage,3);
 c.messages.unshift(reminder(3,6));assert.equal(nextFollowUp(c,settings,at(8)),null);assert.equal(c.state,before.state);assert.deepEqual(c.memory,before.memory);
});
test('resposta do cliente cancela a espera e nova etapa inicia contagem nova',()=>{
 const c=fixture();c.messages.unshift(message('reply','inbound',at(1)));assert.equal(nextFollowUp(c,settings,at(2)),null);
 c.state='ASK_BILLING_DUE_DAY';c.messages.unshift(message('next-bot','outbound',at(1),{inReplyTo:['reply']}));assert.equal(nextFollowUp(c,settings,at(2.99)),null);const next=nextFollowUp(c,settings,at(3));assert.equal(next?.stage,1);assert.match(next!.body,/vencimento/);assert.equal(next?.anchorId,'next-bot');
});
test('atendimento humano, bloqueio, pausa, encerramento e erro pendente impedem envio',()=>{
 for(const state of ['START','MANUAL','BLOCKED','HUMAN_HANDOFF','FINISHED','FINISHED_UNAVAILABLE']){const c=fixture();c.state=state;assert.equal(nextFollowUp(c,settings,at(2)),null);}
 for(const key of ['humanTakeover','blocked','followUpPaused','salesPaused','followUpClosedAt','pendingBotReply']){const c=fixture();c.memory={[key]:true};assert.equal(nextFollowUp(c,settings,at(2)),null);}
 const c=fixture();c.ownerUserId='operator';assert.equal(nextFollowUp(c,settings,at(2)),null);
});
test('mensagem manual no celular ou CRM e pedido de não receber lembretes são respeitados',()=>{
 const c=fixture();c.messages.unshift(message('manual','outbound',at(1),{provider:'evolution'}));assert.equal(nextFollowUp(c,settings,at(3)),null);
 for(const body of ['Não tenho interesse','Pare de mandar mensagens','vou pensar','me chama depois']){const value=fixture();value.messages[1].body=body;assert.equal(nextFollowUp(value,settings,at(2)),null);}
});
test('ativação não dispara contatos antigos em lote; agentes e identidade continuam isolados',()=>{
 const c=fixture();assert.equal(nextFollowUp(c,{...settings,activatedAt:at(1).toISOString()},at(2)),null);assert.equal(nextFollowUp(c,{...settings,enabled:false},at(2)),null);
 assert.equal(nextFollowUp(c,{...settings,instances:['GIGA CLICK']},at(2)),null);c.agent!.zapiInstanceId='GIGA CLICK';assert.equal(nextFollowUp(c,settings,at(2))?.instanceName,'GIGA CLICK');assert.equal(nextFollowUp(c,settings,at(25)),null);
});
function serviceFixture(){
 const c=fixture();const jobs=new Set<string>(),sends:any[]=[],saved:any[]=[],marks:any[]=[];let current=c;
 const repo={settings:async()=>settings,candidates:async()=>[c],get:async()=>current,claim:async(key:string)=>{if(jobs.has(key))return false;jobs.add(key);return true;},mark:async(...args:any[])=>{marks.push(args);},save:async(input:any)=>{saved.push(input);}};
 const service=new FollowUpService(repo as any,async(instance,phone,body)=>{sends.push({instance,phone,body});return{key:{id:'sent-id'}};},()=>at(2));
 return{c,repo,jobs,sends,saved,marks,service,setCurrent:(value:any)=>{current=value;}};
}
test('execuções concorrentes enviam uma única vez e não alteram memória nem fluxo',async()=>{
 const f=serviceFixture(),before=structuredClone(f.c);await Promise.all([f.service.process(),f.service.process()]);assert.equal(f.sends.length,1);assert.equal(f.saved.length,1);assert.equal(f.saved[0].stage,1);assert.equal(f.saved[0].anchorId,'bot');assert.deepEqual(f.c,before);
});
test('nova resposta ou intervenção humana entre seleção e envio cancela o lembrete',async()=>{
 const f=serviceFixture();const current=structuredClone(f.c);current.messages.unshift(message('new-inbound','inbound',at(1)));f.setCurrent(current);await f.service.process();assert.equal(f.sends.length,0);assert.ok(f.marks.some(m=>m[1]==='cancelled'));
});
test('erro incerto de envio não gera reenvio cego no próximo ciclo',async()=>{
 const f=serviceFixture();let attempts=0;const service=new FollowUpService(f.repo as any,async()=>{attempts++;throw Error('Timeout');},()=>at(2));await service.process();await service.process();assert.equal(attempts,1);assert.equal(f.saved.length,0);assert.ok(f.marks.some(m=>m[1]==='review_required'));
});
test('dry run mostra pendências sem envio, reserva nem escrita',async()=>{
 const f=serviceFixture();const result=await f.service.process(true);assert.equal(result.due,1);assert.equal(f.sends.length,0);assert.equal(f.jobs.size,0);assert.equal(f.marks.length,0);
});

test('venda concluída ou perdida não recebe lembrete de contratação',()=>{
 for(const status of ['WON','LOST']){const c=fixture();c.lead={status,deletedAt:null};assert.equal(nextFollowUp(c,settings,at(2)),null);}
});
test('endpoint do agendador exige segredo e falha fechado sem configuração',async()=>{
 const {GET}=require('../src/app/api/cron/conversations-follow-up/route');const before=process.env.CRON_SECRET;
 try{delete process.env.CRON_SECRET;assert.equal((await GET(new Request('https://test.invalid/api/cron/conversations-follow-up'))).status,503);process.env.CRON_SECRET='synthetic-secret-for-test-only';assert.equal((await GET(new Request('https://test.invalid/api/cron/conversations-follow-up'))).status,401);assert.equal((await GET(new Request('https://test.invalid/api/cron/conversations-follow-up',{headers:{authorization:'Bearer wrong-secret'}}))).status,401);}
 finally{if(before===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=before;}
});
