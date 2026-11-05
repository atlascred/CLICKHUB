import {test} from 'node:test';
import assert from 'node:assert/strict';
const Module=require('node:module'),previous=Module._load;
let allowed=true,sendCount=0,targetReads=0,requestBody:any;
const user={id:'employee',role:'EMPLOYEE',permissions:{}};
Module._load=function(name:string,...args:any[]){
 if(name==='@/repositories/inbox.repository')return{InboxRepository:class{async getDeliveryTarget(id:string,scope:any){targetReads++;assert.equal(id,'synthetic');assert.equal(scope,user);return allowed?{id,phone:'5511900000000',agentId:'vivo'}:null;}}};
 if(name==='@/app/api/whatsapp/send/route')return{POST:async(request:Request)=>{sendCount++;requestBody=await request.json();return Response.json({status:'success',data:{conversationId:'synthetic',message:{id:'confirmed',body:'Teste',direction:'outbound',createdAt:'2026-11-05T12:00:00Z'}}});}};
 return previous.call(this,name,...args);
};
const {deliverInboxMessage}=require('../src/modules/conversas/services/inbox-delivery');Module._load=previous;
test('envio consulta somente destino autorizado e retorna mensagem confirmada sem recarregar histórico',async()=>{
 const result=await deliverInboxMessage(new Request('https://fixture.invalid/api/inbox'),user,'synthetic',{message:'Teste'});
 assert.equal(targetReads,1);assert.equal(sendCount,1);assert.equal(requestBody.agentId,'vivo');assert.equal(requestBody.to,'5511900000000');assert.equal(result.message.id,'confirmed');
});
test('destino inacessível interrompe envio antes de chamar a integração',async()=>{
 allowed=false;await assert.rejects(deliverInboxMessage(new Request('https://fixture.invalid/api/inbox'),user,'synthetic',{message:'Teste'}),/não encontrada/);assert.equal(sendCount,1);
});
