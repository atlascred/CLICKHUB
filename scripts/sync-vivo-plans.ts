import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { gigaCommercialPlans } from './lib/giga-commercial-plans';
const db=new PrismaClient(),apply=process.argv.includes('--apply');
const plain=(v:unknown)=>JSON.parse(JSON.stringify(v));
const sort=(v:any)=>({...plain(v),plans:plain(v.plans).sort((a:any,b:any)=>a.id.localeCompare(b.id))});
async function main(){
 const agents=await db.agent.findMany({where:{zapiInstanceId:{in:['CLICK','GIGA CLICK']},deletedAt:null},include:{plans:true}});
 const target=agents.filter(a=>a.zapiInstanceId==='GIGA CLICK'),primary=agents.filter(a=>a.zapiInstanceId==='CLICK');
 assert.equal(target.length,1);assert.equal(primary.length,1);assert.equal(target[0].zapiWhatsappNumber?.replace(/\D/g,''),'5511966271717');
 if(!apply){console.log(JSON.stringify({dryRun:true,target:'VIVO FIBRA',plans:gigaCommercialPlans},null,2));return;}
 mkdirSync('.backups/vivo-plans',{recursive:true});writeFileSync(`.backups/vivo-plans/before-${Date.now()}.json`,JSON.stringify(agents,null,2),{mode:0o600});
 const result=await db.$transaction(async tx=>{
  const before=await tx.agent.findUniqueOrThrow({where:{id:target[0].id},include:{plans:true}});
  assert.equal(before.zapiInstanceId,'GIGA CLICK');assert.equal(before.zapiWhatsappNumber?.replace(/\D/g,''),'5511966271717');
  const shared=await tx.plan.count({where:{agents:{some:{id:before.id}},AND:[{agents:{some:{id:{not:before.id}}}}]}});assert.equal(shared,0,'Catálogo compartilhado; nenhuma alteração aplicada');
  const ids:string[]=[];
  for(const plan of gigaCommercialPlans){const existing=before.plans.find(p=>p.name===plan.name&&!p.deletedAt);const data={...plan,active:true,deletedAt:null};const saved=existing?await tx.plan.update({where:{id:existing.id},data}):await tx.plan.create({data:{...data,agents:{connect:{id:before.id}}}});ids.push(saved.id);}
  await tx.plan.updateMany({where:{id:{in:before.plans.filter(p=>!ids.includes(p.id)).map(p=>p.id)}},data:{active:false,deletedAt:new Date()}});
  await tx.agent.update({where:{id:before.id},data:{plans:{set:ids.map(id=>({id}))}}});
  const after=await tx.agent.findUniqueOrThrow({where:{id:before.id},include:{plans:true}});
  const protectedFields=(v:any)=>{const {plans,updatedAt,...rest}=plain(v);return rest;};assert.deepEqual(protectedFields(after),protectedFields(before));
  const nio=await tx.agent.findUniqueOrThrow({where:{id:primary[0].id},include:{plans:true}});assert.deepEqual(sort(nio),sort(primary[0]));
  return after.plans.sort((a,b)=>a.order-b.order).map(p=>({id:p.id,name:p.name,speed:p.speed,price:Number(p.price),description:p.description,active:p.active}));
 },{timeout:45000});
 assert.deepEqual(result.map(p=>({name:p.name,price:p.price})),gigaCommercialPlans.map(p=>({name:p.name,price:p.price})));
 const report={applied:true,target:'VIVO FIBRA',plans:result,nioUnchanged:true,coverageAndFlowPreserved:true,customerMessagesSent:0};mkdirSync('.test-output/vivo-plans',{recursive:true});writeFileSync('.test-output/vivo-plans/sync-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
