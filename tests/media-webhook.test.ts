import {test} from 'node:test';
import assert from 'node:assert/strict';
const Module=require('node:module'),original=Module._load;
let state='ASK_EMAIL',ownerUserId:string|null=null,configs=0,downloads=0,transcriptions=0,queued:any,sql:any;
const agent={id:'11111111-1111-4111-8111-111111111111',zapiInstanceId:'GIGA CLICK',name:'Lily',plans:[]};
const db={chatConversation:{findFirst:async()=>({state,memory:{},ownerUserId})},$executeRaw:async(strings:any,...values:any[])=>{sql={text:strings.join('?'),values};return 1;}};
Module._load=function(name:string,...args:any[]){
 if(name==='@/lib/prisma')return{prisma:db};
 if(name==='@/repositories/chatbot.repository')return{ChatbotRepository:class{async getAgentByInstance(){return agent;}}};
 if(name==='@/modules/chatbot/services/chatbot-engine.service')return{ChatbotEngineService:class{}};
 if(name==='@/modules/chatbot/services/message-batch.service')return{MessageBatchService:class{async accept(_scope:any,message:any){queued=message;return{queued:true};}}};
 if(name==='@/lib/integration-config')return{getOpenAiRuntimeConfig:async()=>{configs++;return{apiKey:'fake-key',model:'gpt-4o-mini'};}};
 if(name==='@/services/evolution-media')return{downloadEvolutionMedia:async()=>{downloads++;return{bytes:Buffer.from('synthetic audio'),mimeType:'audio/ogg',fileName:'a.ogg'};}};
 if(name==='@/services/openai/openai.service')return{OpenAiService:class{async transcribeAudio(input:any){transcriptions++;assert.ok(input.url.startsWith('data:audio/ogg;base64,'));return 'Conteúdo fictício';}async extractCustomerData(){return{};}}};
 if(name==='@/lib/logger')return{writeTechnicalLog:async()=>{}};
 return original.call(this,name,...args);
};
const {handleEvolutionWebhook}=require('../src/app/api/whatsapp/webhook/handler');Module._load=original;
process.env.EVOLUTION_INSTANCES_JSON=JSON.stringify([{instanceName:'GIGA CLICK',apiUrl:'https://giga.test',apiKey:'fake-giga',number:'5511900000001'}]);
const payload={event:'messages.upsert',instance:'GIGA CLICK',data:{key:{id:'audio-1',remoteJid:'5511900000002@s.whatsapp.net',fromMe:false},message:{audioMessage:{url:'https://mmg.whatsapp.net/audio.enc',mediaKey:'fake',mimetype:'audio/ogg'}}}};
const request=(body:any)=>new Request('https://app.test/api/whatsapp/webhook/instances/GIGA%20CLICK',{method:'POST',headers:{'content-type':'application/json',apikey:'fake-giga'},body:JSON.stringify(body)});

test('áudio autorizado é descriptografado antes da transcrição; referência original permanece no histórico',async()=>{
 const response=await handleEvolutionWebhook(request(payload));assert.equal(response.status,200);assert.equal(downloads,1);assert.equal(transcriptions,1);assert.equal(queued.body,'Conteúdo fictício');assert.equal(queued.rawPayload.raw.data.message.audioMessage.url,'https://mmg.whatsapp.net/audio.enc');
});
test('conversa encerrada ou manual não baixa nem envia arquivo à IA',async()=>{
 const before={configs,downloads,transcriptions};for(const current of ['FINISHED','MANUAL','HUMAN_HANDOFF']){state=current;const response=await handleEvolutionWebhook(request(payload));assert.equal(response.status,200);assert.ok(queued.rawPayload.raw.data.message.audioMessage);}
 assert.deepEqual({configs,downloads,transcriptions},before);
 state='ASK_EMAIL';ownerUserId='owner';await handleEvolutionWebhook(request(payload));assert.deepEqual({configs,downloads,transcriptions},before);
});
test('status soma metadados e restringe atualização ao agente, preservando o anexo',async()=>{
 const response=await handleEvolutionWebhook(request({event:'messages.update',instance:'GIGA CLICK',data:[{key:{id:'audio-1'},update:{status:'READ'}}]}));assert.equal(response.status,200);assert.ok(sql.text.includes('COALESCE(m."rawPayload"'));assert.ok(sql.text.includes('||'));assert.ok(sql.text.includes('"agentId"'));assert.ok(sql.values.includes(agent.id));
});
