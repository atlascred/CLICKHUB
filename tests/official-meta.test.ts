import { test } from 'node:test';
import * as legacy from '../src/services/whatsapp-broadcast';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { buildTemplatePayload, templateUnsupportedReason, type OfficialTemplate } from '../src/modules/envio-em-massa/lib/templates';
import { MassMessageService, type Campaign, type CampaignStore } from '../src/modules/envio-em-massa/services/mass-message.service';
import { MetaRequestError, OfficialMetaClient, officialMetaReadiness } from '../src/modules/envio-em-massa/services/official-meta.service';
import { isValidMetaWebhook } from '../src/services/meta-whatsapp';
const template: OfficialTemplate = { id: 't1', name: 'oferta', language: 'pt_BR', status: 'APPROVED', components: [{ type: 'BODY', text: 'Olá {{1}}, oferta {{2}}' }] };
test('campanha envia exclusivamente modelos aprovados com variáveis completas',()=>{
 assert.throws(()=>buildTemplatePayload({...template,status:'PAUSED'},{}),/aprovado/);
 assert.throws(()=>buildTemplatePayload(template,{'BODY:1':'João'}),/variáveis/);
 assert.deepEqual(buildTemplatePayload(template,{'BODY:1':'João','BODY:2':'800 mega'}),{name:'oferta',language:{code:'pt_BR'},components:[{type:'body',parameters:[{type:'text',text:'João'},{type:'text',text:'800 mega'}]}]});
 const named={...template,parameter_format:'NAMED',components:[{type:'HEADER',format:'TEXT',text:'Olá {{nome}}'},{type:'BODY',text:'{{plano}}'}]};
 assert.equal((buildTemplatePayload(named,{'HEADER:nome':'Ana','BODY:plano':'800'}).components![0] as any).parameters[0].parameter_name,'nome');
 assert.ok(templateUnsupportedReason({...template,components:[{type:'BUTTONS',buttons:[{type:'URL',url:'https://example.com/{{1}}'}]}]}));
 const image={...template,components:[{type:'HEADER',format:'IMAGE'}]};
 assert.throws(()=>buildTemplatePayload(image,{},'http://example.com/a.png'),/HTTPS/);
 assert.equal((buildTemplatePayload(image,{},'https://example.com/a.png').components![0] as any).parameters[0].image.link,'https://example.com/a.png');
});
function fixture(send: (phone:string)=>Promise<string>) {
 let campaign:Campaign={id:'11111111-1111-4111-8111-111111111111',ownerId:'owner',phoneNumberId:'123',fingerprint:'fp',createdAt:new Date().toISOString(),template:{name:'oferta'},recipients:[{phone:'5511900000000',status:'queued'},{phone:'5511900000001',status:'queued'}]};
 const store:CampaignStore={get:async()=>structuredClone(campaign),create:async()=>{},replace:async(prev,next)=>{if(JSON.stringify(prev)!==JSON.stringify(campaign))return false;campaign=structuredClone(next);return true;}};
 return {service:new MassMessageService(store,send),store,get:()=>campaign};
}
test('requisições concorrentes não repetem o contato; campanha retoma apenas pendentes',async()=>{
 const calls:string[]=[];let release!:()=>void;const held=new Promise<void>(r=>{release=r;});
 const f=fixture(async phone=>{calls.push(phone);await held;return 'wamid.'+phone;});
 const first=f.service.next(f.get().id,'owner','123');
 await new Promise(r=>setImmediate(r));
 await f.service.next(f.get().id,'owner','123');assert.equal(calls.length,1);
 release();await first;
 await f.service.next(f.get().id,'owner','123');await f.service.next(f.get().id,'owner','123');
 assert.equal(calls.length,2);assert.ok(f.get().recipients.every(r=>r.status==='accepted'));
 await assert.rejects(f.service.next(f.get().id,'other','123'),/encontrada/);
 await assert.rejects(f.service.next(f.get().id,'owner','456'),/alterado/);
});
test('timeouts não são reenviados; falhas explícitas e aceitações são diferentes',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw new MetaRequestError('Sem confirmação',true);});
 await f.service.next(f.get().id,'owner','123');await f.service.next(f.get().id,'owner','123');await f.service.next(f.get().id,'owner','123');
 assert.equal(calls,2);assert.ok(f.get().recipients.every(r=>r.status==='uncertain'));
 const bad=fixture(async()=>{throw new MetaRequestError('Recusada',false);});
 await bad.service.next(bad.get().id,'owner','123');assert.equal(bad.get().recipients[0].status,'failed');
 const stale=fixture(async()=>{throw new Error('Should not send');});
 const previous=await stale.store.get('id');const next=structuredClone(previous!);next.recipients[0]={...next.recipients[0],status:'sending',startedAt:'2020-01-01T00:00:00Z'};await stale.store.replace(previous!,next);
 await stale.service.next(next.id,'owner','123');assert.equal(stale.get().recipients[0].status,'uncertain');
});
test('configuração incompleta bloqueia rede; Graph usa token privado e modelos aprovados paginados',async()=>{
 const keys=['META_WHATSAPP_ACCESS_TOKEN','META_WHATSAPP_PHONE_NUMBER_ID','META_WHATSAPP_BUSINESS_ACCOUNT_ID','META_WHATSAPP_APP_SECRET','META_WHATSAPP_VERIFY_TOKEN','META_GRAPH_API_VERSION'];
 const original=keys.map(k=>process.env[k]);let calls=0;
 try {
  for(const key of keys)delete process.env[key];
  const client=new OfficialMetaClient(async()=>{calls++;return Response.json({});});
  assert.equal(officialMetaReadiness().configured,false);await assert.rejects(client.templates(),/Cadastre/);assert.equal(calls,0);
  keys.slice(0,5).forEach((key,i)=>{process.env[key]=i===1?'123':i===2?'456':'private';});
  const requests:any[]=[];
  const configured=new OfficialMetaClient(async(url,init)=>{requests.push({url,init});return Response.json(requests.length===1?{data:[template,{...template,status:'REJECTED'}],paging:{next:'https://evil.example/token',cursors:{after:'next'}}}:{data:[{...template,id:'t2'}]});});
  const templates=await configured.templates();assert.equal(templates.length,2);assert.ok(requests.every(r=>r.url.startsWith('https://graph.facebook.com/')));assert.ok(requests[1].url.includes('after=next'));assert.ok(!JSON.stringify(officialMetaReadiness()).includes('private'));
  const refused=new OfficialMetaClient(async()=>Response.json({error:{code:190,message:'secret-token'}},{status:400}));
  await assert.rejects(refused.send('5511900000000',{},'id'),e=>e instanceof MetaRequestError && !e.uncertain && !e.message.includes('secret-token'));
  const offline=new OfficialMetaClient(async()=>{throw new Error('timeout');});await assert.rejects(offline.send('5511900000000',{},'id'),e=>e instanceof MetaRequestError && e.uncertain);
 } finally {keys.forEach((key,i)=>{if(original[i]===undefined)delete process.env[key];else process.env[key]=original[i];});}
});
test('webhook exige segredo e assinatura válida',()=>{
 const previous=process.env.META_WHATSAPP_APP_SECRET;
 try {
  delete process.env.META_WHATSAPP_APP_SECRET;assert.equal(isValidMetaWebhook(new Request('https://example.com'),'{}'),false);
  process.env.META_WHATSAPP_APP_SECRET='secret';
  const signature='sha256='+createHmac('sha256','secret').update('{}').digest('hex');
  assert.equal(isValidMetaWebhook(new Request('https://example.com',{headers:{'x-hub-signature-256':signature}}),'{}'),true);
  assert.equal(isValidMetaWebhook(new Request('https://example.com',{headers:{'x-hub-signature-256':signature}}),'{"tampered":true}'),false);
 }finally{if(previous===undefined)delete process.env.META_WHATSAPP_APP_SECRET;else process.env.META_WHATSAPP_APP_SECRET=previous;}
});
test('Evolution não depende da chave global Meta; rotas antigas não enviam',async()=>{
 for(const path of ['src/app/api/whatsapp/send/route.ts','src/app/api/whatsapp/webhook/handler.ts','src/app/api/whatsapp/verify/route.ts','src/app/api/evolution/health/route.ts','src/modules/chatbot/services/chatbot-engine.service.ts'])assert.ok(!readFileSync(path,'utf8').includes('isMetaWhatsAppEnabled'),path);
 const official=readFileSync('src/app/api/envio-em-massa/route.ts','utf8');assert.ok(!official.includes('/api/whatsapp/send'));assert.ok(!official.includes('resolveSelectedAgent'));
 assert.deepEqual(await legacy.processDueBroadcasts(),{processed:0});await assert.rejects(legacy.processBroadcastMessage({} as any),/desativado/);
});

test('webhook oficial percorre eventos, isola WABA/número e preserva leitura contra status atrasado',async()=>{
 const {POST,GET}=require('../src/app/api/whatsapp/meta/webhook/route');
 const {campaignStore}=require('../src/modules/envio-em-massa/services/campaign-store');
 const original={get:campaignStore.get,replace:campaignStore.replace};
 const keys=['META_WHATSAPP_APP_SECRET','META_WHATSAPP_PHONE_NUMBER_ID','META_WHATSAPP_BUSINESS_ACCOUNT_ID','META_WHATSAPP_VERIFY_TOKEN'];const saved=keys.map(k=>process.env[k]);
 const f=fixture(async()=> 'wamid.test');await f.service.next(f.get().id,'owner','123');
 const accepted=await f.store.get(f.get().id);const waiting=structuredClone(accepted!);waiting.recipients[0].status='sending';delete waiting.recipients[0].messageId;await f.store.replace(accepted!,waiting);
 campaignStore.get=f.store.get;campaignStore.replace=f.store.replace;
 try{
  process.env.META_WHATSAPP_APP_SECRET='secret';process.env.META_WHATSAPP_PHONE_NUMBER_ID='123';process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID='456';process.env.META_WHATSAPP_VERIFY_TOKEN='verify';
  assert.equal((await GET(new Request('https://example.com?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=challenge'))).status,200);
  assert.equal((await GET(new Request('https://example.com?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=challenge'))).status,403);
  const status=(state:string)=>({id:'wamid.test',recipient_id:'551100000000',status:state,biz_opaque_callback_data:f.get().id+':5511900000000'});
  const change=(phone:string,state:string)=>({field:'messages',value:{metadata:{phone_number_id:phone},statuses:[status(state)]}});
  async function post(entry:any[]){const raw=JSON.stringify({object:'whatsapp_business_account',entry});return POST(new Request('https://example.com',{method:'POST',body:raw,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','secret').update(raw).digest('hex')}}));}
  assert.equal((await post([{id:'other',changes:[change('123','read')]},{id:'456',changes:[change('other','read')]}])).status,200);assert.equal(f.get().recipients[0].status,'sending');
  assert.equal((await post([{id:'456',changes:[change('123','delivered'),change('123','read')]}])).status,200);assert.equal(f.get().recipients[0].status,'read');
  await post([{id:'456',changes:[change('123','sent'),change('123','delivered'),change('123','failed')]}]);assert.equal(f.get().recipients[0].status,'read');
 }finally{Object.assign(campaignStore,original);keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
