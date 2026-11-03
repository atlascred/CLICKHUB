import {OpenAiService} from "../src/services/openai/openai.service";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendEvolutionAudioMessage,sendEvolutionMediaMessage,parseEvolutionWebhookPayload,extractEvolutionStatusUpdates,isEvolutionStatusWebhook} from '../src/services/evolution';
import {withEvolutionInstance} from '../src/services/evolution-context';
import {attachmentForMessage,decodeMediaBase64,describeMedia,mediaEnvelope} from '../src/lib/whatsapp-media';
import {downloadEvolutionMedia} from '../src/services/evolution-media';
import {mediaResponse} from '../src/lib/media-response';

process.env.EVOLUTION_INSTANCE='CLICK';process.env.EVOLUTION_API_URL='https://click.test';process.env.EVOLUTION_INSTANCE_TOKEN='fake-click';process.env.EVOLUTION_DEFAULT_NUMBER='5511900000000';
process.env.EVOLUTION_INSTANCES_JSON=JSON.stringify([{instanceName:'GIGA CLICK',apiUrl:'https://giga.test',apiKey:'fake-giga',number:'5511900000001'}]);
const bytes=Buffer.from('synthetic media fixture');const base64=bytes.toString('base64');
function webhook(type:string,wrapper?:string){const message={[type]:{url:'https://mmg.whatsapp.net/media.enc',mimetype:type==='audioMessage'?'audio/ogg':type==='imageMessage'?'image/png':type==='videoMessage'?'video/mp4':'application/pdf',fileName:'arquivo.pdf',mediaKey:'fake-media-key'}};return{event:'messages.upsert',instance:'GIGA CLICK',data:{key:{id:'fixture',remoteJid:'5511900000002@s.whatsapp.net',fromMe:false},message:wrapper?{[wrapper]:{message}}:message}};}

test('áudio usa sendWhatsAppAudio, campo audio e conversão de WebM/Opus',async()=>{
 let calls=0;global.fetch=async(url,options)=>{calls++;assert.match(String(url),/\/message\/sendWhatsAppAudio\/CLICK$/);const body=JSON.parse(String(options?.body));assert.equal(body.audio,base64);assert.equal(body.encoding,true);assert.equal(body.media,undefined);assert.equal((options?.headers as any).apikey,'fake-click');return Response.json({key:{id:'sent'}},{status:201});};
 await withEvolutionInstance('CLICK',()=>sendEvolutionAudioMessage({to:'11900000002',audio:`data:audio/webm;codecs=opus;base64,${base64}`,mimeType:'audio/webm;codecs=opus'}));assert.equal(calls,1);
});
test('fallback multipart usa file no endpoint correto e só após rejeição 415',async()=>{
 let calls=0;global.fetch=async(url,options)=>{calls++;assert.match(String(url),/sendWhatsAppAudio\/GIGA%20CLICK$/);if(calls===1)return Response.json({message:'Unsupported media type'},{status:415});const form=options?.body as FormData;assert.ok(form.get('file') instanceof File);assert.equal(form.get('media'),null);assert.equal(form.get('number'),'5511900000002');return Response.json({key:{id:'sent'}},{status:201});};
 await withEvolutionInstance('GIGA CLICK',()=>sendEvolutionAudioMessage({to:'5511900000002',audio:base64,mimeType:'audio/ogg'}));assert.equal(calls,2);
});
for(const kind of ['imagem','video','documento'] as const)test(`envio de ${kind} mantém tipo, nome e legenda`,async()=>{
 global.fetch=async(url,options)=>{assert.match(String(url),/sendMedia\/CLICK$/);const b=JSON.parse(String(options?.body));assert.equal(b.mediatype,kind==='imagem'?'image':kind==='video'?'video':'document');assert.equal(b.fileName,'teste.ext');assert.equal(b.caption,'Legenda');assert.equal(b.media,base64);return Response.json({key:{id:'sent'}},{status:201});};
 await withEvolutionInstance('CLICK',()=>sendEvolutionMediaMessage({to:'5511900000002',kind,media:`data:application/octet-stream;base64,${base64}`,fileName:'teste.ext',caption:'Legenda'}));
});
test('falhas 500 e timeout não provocam reenvio e não escondem o erro original',async()=>{
 for(const mode of ['500','timeout']){let calls=0;global.fetch=async()=>{calls++;if(mode==='timeout')throw new DOMException('timeout','TimeoutError');return Response.json({message:'Failed to convert audio'},{status:500});};await assert.rejects(withEvolutionInstance('CLICK',()=>sendEvolutionAudioMessage({to:'5511900000002',audio:base64})));assert.equal(calls,1);}
});
for(const [type,kind]of [['audioMessage','audio'],['imageMessage','imagem'],['videoMessage','video'],['documentMessage','documento']] as const)test(`recebimento ${kind} reconhece envelope e anexo privado`,()=>{
 for(const wrapper of [undefined,'ephemeralMessage','viewOnceMessageV2','documentWithCaptionMessage']){
  const raw=webhook(type,wrapper);const parsed=parseEvolutionWebhookPayload(raw);assert.equal(parsed.event,'message');if(parsed.event!=='message')throw Error();assert.equal(parsed.kind,kind);assert.ok(parsed.mimeType);
  const payload={provider:'evolution',kind,raw};const descriptor=attachmentForMessage('message-id',payload);assert.equal(descriptor?.kind,kind);assert.equal(descriptor?.url,'/api/conversations/messages/message-id/media');assert.ok(!JSON.stringify(descriptor).includes('mediaKey'));assert.equal(mediaEnvelope(payload)?.key,raw.data.key);
 }
});
test('base64 em webhook prevalece sobre URL criptografada',async()=>{
 const raw=webhook('audioMessage');(raw.data as any).base64=base64;const payload={kind:'audio',raw};assert.equal(describeMedia(payload)?.source,base64);
 global.fetch=async()=>{throw new Error('No network expected');};const result=await withEvolutionInstance('GIGA CLICK',()=>downloadEvolutionMedia(payload));assert.deepEqual(result.bytes,bytes);
});
test('download descriptografa com a instância de origem e envelope completo',async()=>{
 const payload={kind:'audio',raw:webhook('audioMessage','ephemeralMessage')};let calls=0;
 global.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://giga.test/chat/getBase64FromMediaMessage/GIGA%20CLICK');assert.equal((options?.headers as any).apikey,'fake-giga');const body=JSON.parse(String(options?.body));assert.equal(body.message.key.id,'fixture');assert.ok(body.message.message.audioMessage);return Response.json({base64,mimetype:'audio/ogg',fileName:'recebido.ogg'});};
 const result=await withEvolutionInstance('GIGA CLICK',()=>downloadEvolutionMedia(payload));assert.equal(calls,1);assert.equal(result.mimeType,'audio/ogg');assert.deepEqual(result.bytes,bytes);
});
test('não reproduz bytes .enc quando a descriptografia falha',async()=>{
 let calls=0;global.fetch=async(url)=>{calls++;assert.ok(!String(url).includes('whatsapp.net'));return Response.json({message:'expired'},{status:400});};
 await assert.rejects(withEvolutionInstance('CLICK',()=>downloadEvolutionMedia({kind:'audio',raw:webhook('audioMessage')})),/descriptografar/);assert.equal(calls,1);
});
test('download de URL pública não recebe o token da Evolution',async()=>{
 global.fetch=async(_url,options)=>{assert.deepEqual(options?.headers,{});return new Response(bytes,{headers:{'Content-Type':'image/png'}});};
 const result=await withEvolutionInstance('CLICK',()=>downloadEvolutionMedia({kind:'imagem',media:{source:'https://files.test/test.png',mimeType:'image/png'}}));assert.deepEqual(result.bytes,bytes);
});
test('data URL aceita codecs e bloqueia conteúdo malformado',()=>{
 assert.deepEqual(decodeMediaBase64(`data:audio/ogg;codecs=opus;base64,${base64}`)?.bytes,bytes);
 assert.equal(decodeMediaBase64('data:audio/ogg,invalid'),null);assert.equal(decodeMediaBase64('https://example.test'),null);
});
test('reprodução suporta range inicial, final, inválido e download privado',async()=>{
 const data=new Uint8Array([1,2,3,4,5]);
 for(const [range,status,expected] of [['bytes=1-3',206,[2,3,4]],['bytes=-2',206,[4,5]],['bytes=3-',206,[4,5]],['bytes=9-',416,[]],['bytes=0-1,3-4',416,[]]] as const){const res=mediaResponse(new Request('https://app.test',{headers:{range}}),data,'audio/ogg','a.ogg');assert.equal(res.status,status);assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[...expected]);assert.equal(res.headers.get('Cache-Control'),'private, no-store');}
 const res=mediaResponse(new Request('https://app.test'),data,'text/html','teste.html');assert.match(res.headers.get('Content-Disposition')!,/^attachment/);assert.equal(res.headers.get('X-Content-Type-Options'),'nosniff');
});

test('PDF em memória usa file_data e nome, imagem usa image_url',async()=>{
 const requests:any[]=[];const ai=new OpenAiService(async()=>({apiKey:'fake-test',model:'gpt-4o-mini'}),(()=>({responses:{create:async(input:any)=>{requests.push(input);return{output_text:'{}'};}}})) as any);
 await ai.extractCustomerData({url:`data:application/pdf;base64,${base64}`,mimeType:'application/pdf',fileName:'comprovante.pdf'});
 const file=requests[0].input[0].content[1];assert.equal(file.type,'input_file');assert.equal(file.filename,'comprovante.pdf');assert.ok(file.file_data.startsWith('data:application/pdf;base64,'));assert.equal(file.file_url,undefined);
 await ai.extractCustomerData({url:`data:image/png;base64,${base64}`,mimeType:'image/png'});assert.equal(requests[1].input[0].content[1].type,'input_image');
});
test('transcrição recebe os bytes de uma data URL com codec',async()=>{
 let called=0;
 const ai=new OpenAiService(async()=>({apiKey:'fake-test',model:'gpt-4o-mini'}),(()=>({audio:{transcriptions:{create:async(input:any)=>{called++;assert.deepEqual(Buffer.from(await input.file.arrayBuffer()),bytes);assert.equal(input.file.type,'audio/ogg');return{text:'Texto fictício'};}}}})) as any);
 assert.equal(await ai.transcribeAudio({url:`data:audio/ogg;codecs=opus;base64,${base64}`,mimeType:'audio/ogg;codecs=opus'}),'Texto fictício');assert.equal(called,1);
});

test('callbacks reais Evolution 2.3.7 usam keyId e aceitam nome de evento normalizado',()=>{
 const payload={event:'MESSAGES_UPDATE',data:{keyId:'provider-audio-id',messageId:'evolution-database-id',status:'READ',fromMe:true}};
 assert.equal(isEvolutionStatusWebhook(payload),true);assert.deepEqual(extractEvolutionStatusUpdates(payload),[{messageId:'provider-audio-id',status:'lido'}]);
});
