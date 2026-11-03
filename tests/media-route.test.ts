import {test} from 'node:test';
import assert from 'node:assert/strict';
const Module=require('node:module');
const previous=Module._load;
let user:any={id:'owner',role:'EMPLOYEE',permissions:{'conversations:view':true}};
let query:any;
const rawPayload={provider:'evolution',kind:'audio',media:{source:'data:audio/ogg;base64,AQIDBAU=',mimeType:'audio/ogg',fileName:'teste.ogg'}};
const db={chatMessage:{findFirst:async(input:any)=>{query=input;const access=input.where.conversation;if(access.ownerUserId&&access.ownerUserId!=='owner')return null;return{rawPayload,conversation:{agent:{zapiInstanceId:'GIGA CLICK'}}};}}};
Module._load=function(name:string,...args:any[]){if(name==='@/lib/prisma')return{prisma:db};if(name==='@/lib/auth-context')return{requireCurrentUser:async()=>{if(!user)throw new Error('UNAUTHORIZED');return user;}};return previous.call(this,name,...args);};
const {GET}=require('../src/app/api/conversations/messages/[id]/media/route');Module._load=previous;
process.env.EVOLUTION_INSTANCES_JSON=JSON.stringify([{instanceName:'GIGA CLICK',apiUrl:'https://giga.test',apiKey:'test',number:'5511900000001'}]);

test('anexo respeita usuário, permissões e suporte a range sem expor credenciais',async()=>{
 let response=await GET(new Request('https://app.test/media',{headers:{range:'bytes=1-3'}}),{params:Promise.resolve({id:'file'})});
 assert.equal(response.status,206);assert.equal(query.where.conversation.ownerUserId,'owner');assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[2,3,4]);
 user={...user,id:'another-user'};response=await GET(new Request('https://app.test/media'),{params:Promise.resolve({id:'file'})});assert.equal(response.status,404);
 user={id:'owner',role:'EMPLOYEE',permissions:{}};response=await GET(new Request('https://app.test/media'),{params:Promise.resolve({id:'file'})});assert.equal(response.status,403);
 user=null;response=await GET(new Request('https://app.test/media'),{params:Promise.resolve({id:'file'})});assert.equal(response.status,401);
});
