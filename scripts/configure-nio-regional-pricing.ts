import { PrismaClient, Prisma } from '@prisma/client';
import { loadEnvConfig } from '@next/env';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { nioNormalPlans, nioBtuCities } from '../src/modules/chatbot/nio-regional-pricing';
loadEnvConfig(process.cwd());
const db = new PrismaClient();
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const canonical = (agent: any) => ({ ...plain(agent), plans: plain(agent.plans).sort((a: any,b: any) => a.id.localeCompare(b.id)) });
async function main() {
  const agents = await db.agent.findMany({ where: { deletedAt: null, zapiInstanceId: { in: ['CLICK','GIGA CLICK'] } }, include: { plans: true } });
  const nio = agents.filter(a => a.zapiInstanceId === 'CLICK'), vivo = agents.filter(a => a.zapiInstanceId === 'GIGA CLICK');
  assert.equal(nio.length,1); assert.equal(vivo.length,1);
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({dryRun:true,target:'NIO FIBRA',normalPlans:nioNormalPlans,btuCities:Object.values(nioBtuCities).flat().length,vivoWillBeChanged:false},null,2)); return;
  }
  mkdirSync('.backups/nio-regional-pricing',{recursive:true});
  writeFileSync(`.backups/nio-regional-pricing/before-${Date.now()}.json`,JSON.stringify(agents,null,2),{mode:0o600});
  const result = await db.$transaction(async tx => {
    const before = await tx.agent.findUniqueOrThrow({ where:{id:nio[0].id},include:{plans:true} });
    const vivoBefore = await tx.agent.findUniqueOrThrow({ where:{id:vivo[0].id},include:{plans:true} });
    assert.equal(before.zapiInstanceId,'CLICK');
    assert.equal(await tx.plan.count({where:{agents:{some:{id:before.id}},AND:[{agents:{some:{id:{not:before.id}}}}]}}),0,'Plano compartilhado; operação interrompida');
    const rules = before.rules && typeof before.rules === 'object' && !Array.isArray(before.rules) ? before.rules as Record<string,any> : {};
    const existing = rules.nioRegionalPricing;
    const special = existing?.btuPlanIds ? before.plans.filter(p=>existing.btuPlanIds.includes(p.id)) : before.plans.filter(p=>p.active&&!p.deletedAt);
    assert.deepEqual(special.map(p=>Number(p.price)).sort((a,b)=>a-b),[55,70,85],'BTU atual diverge do catálogo autorizado');
    assert.ok(special.every(p=>p.active&&!p.deletedAt));
    const normalIds:string[]=[];
    for (const [index,spec] of nioNormalPlans.entries()) {
      const id=existing?.normalPlanIds?.[index];
      if(id)assert.ok(before.plans.some(p=>p.id===id),'Plano normal fora do vínculo NIO');
      const saved=id?await tx.plan.update({where:{id},data:{...spec,active:true,deletedAt:null}})
        :await tx.plan.create({data:{...spec,agents:{connect:{id:before.id}}}});
      normalIds.push(saved.id);
    }
    const policy={version:1,btuPlanIds:special.sort((a,b)=>a.order-b.order).map(p=>p.id),normalPlanIds:normalIds};
    await tx.agent.update({where:{id:before.id},data:{rules:plain({...rules,nioRegionalPricing:policy}) as Prisma.InputJsonValue}});
    const after=await tx.agent.findUniqueOrThrow({where:{id:before.id},include:{plans:true}});
    const vivoAfter=await tx.agent.findUniqueOrThrow({where:{id:vivo[0].id},include:{plans:true}});
    assert.deepEqual(canonical(vivoAfter),canonical(vivoBefore),'VIVO deve permanecer integralmente intacta');
    assert.deepEqual(canonical(vivoAfter),canonical(vivo[0]),'VIVO mudou desde a conferência inicial');
    assert.deepEqual(after.plans.filter(p=>policy.btuPlanIds.includes(p.id)).map(plain).sort((a,b)=>a.id.localeCompare(b.id)),special.map(plain).sort((a,b)=>a.id.localeCompare(b.id)),'Catálogo BTU deve ser preservado');
    const protectedFields=(a:any)=>{const {rules,plans,updatedAt,...rest}=plain(a);return rest;};
    assert.deepEqual(protectedFields(after),protectedFields(before));
    const {nioRegionalPricing:ignored,...otherRules}=plain(after.rules);
    const {nioRegionalPricing:previous,...originalRules}=rules;
    assert.deepEqual(otherRules,originalRules);
    return {applied:true,target:'NIO FIBRA',btuPrices:special.map(p=>Number(p.price)),normalPrices:nioNormalPlans.map(p=>p.price),btuCities:Object.values(nioBtuCities).flat().length,vivoUnchanged:true,otherNioSettingsUnchanged:true,messagesSent:0};
  },{timeout:45000});
  mkdirSync('.test-output/nio-regional-pricing',{recursive:true});
  writeFileSync('.test-output/nio-regional-pricing/configuration.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
