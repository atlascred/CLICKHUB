import { PrismaClient, type Prisma } from "@prisma/client";
import { createReadStream, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";

const db=new PrismaClient();
const apply=process.argv.includes('--apply'),activate=process.argv.includes('--activate');
const folder='.test-output/coverage';
const manifest=JSON.parse(readFileSync(`${folder}/manifest.json`,'utf8'));
const targetNumber='5511966271717';
const digit=(value:unknown)=>String(value||'').replace(/\D/g,'');
function stableUuid(dataset:string,cep:string){const digest=createHash('sha256').update(`${dataset}\0${cep}`).digest('hex').slice(0,32).split('');digest[12]='5';digest[16]=((parseInt(digest[16],16)&3)|8).toString(16);const h=digest.join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
const normalized=(value:unknown)=>JSON.parse(JSON.stringify(value));
async function main(){
  const agents=await db.agent.findMany({where:{zapiInstanceId:'GIGA CLICK',active:true,deletedAt:null},include:{plans:{orderBy:{id:'asc'}}}});
  if(agents.length!==1||digit(agents[0].zapiWhatsappNumber)!==targetNumber)throw new Error('O agente não corresponde ao número solicitado. Nada alterado.');
  const agent=agents[0],dataset=`agent-coverage:${agent.id}:${manifest.sourceHash.slice(0,20)}`;
  const list=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?list(resolve(dir,entry.name)):entry.name.toLowerCase().endsWith('.xlsx')&&!entry.name.startsWith('~$')?[relative(resolve('CEPS VIVO'),resolve(dir,entry.name))]:[]);
  const actualFiles=list(resolve('CEPS VIVO')).sort();
  if(!manifest.uniqueCeps||!manifest.files.length||JSON.stringify(actualFiles)!==JSON.stringify(manifest.files.map((file:{file:string})=>file.file).sort()))throw new Error('Manifesto incompleto ou conjunto de arquivos alterado.');
  for(const file of manifest.files){const actual=createHash('sha256').update(readFileSync(resolve('CEPS VIVO',file.file))).digest('hex');if(actual!==file.sha256)throw new Error(`Planilha alterada após a extração: ${file.file}`);}
  if(!apply){console.log(JSON.stringify({dryRun:true,instance:'GIGA CLICK',number:targetNumber,workbooks:manifest.files.length,rows:manifest.validRows,uniqueCeps:manifest.uniqueCeps,dataset},null,2));return;}
  const health=await fetch('https://clickhub-peach.vercel.app/api/whatsapp/webhook',{signal:AbortSignal.timeout(15000)});const status=await health.json();
  if(!health.ok||status.data?.coverageVersion!==1)throw new Error('Publique primeiro o código com isolamento da base.');
  mkdirSync('.backups/coverage-20261103',{recursive:true});
  writeFileSync(`.backups/coverage-20261103/agent-before-import-${Date.now()}.json`,JSON.stringify(agent,null,2),{mode:0o600});
  const cepHash=createHash('sha256');let processed=0,inserted=0;let batch:Prisma.CoverageCepCreateManyInput[]=[];let last='';const now=new Date();
  async function flush(){if(!batch.length)return;const saved=await db.coverageCep.createMany({data:batch,skipDuplicates:true});inserted+=saved.count;batch=[];if(processed%20000===0)console.log(JSON.stringify({processed,inserted,total:manifest.uniqueCeps}));}
  const lines=createInterface({input:createReadStream(`${folder}/ceps.jsonl`),crlfDelay:Infinity});
  for await(const line of lines){const row=JSON.parse(line);if(!/^\d{8}$/.test(row.cep)||row.cep<=last)throw new Error('CEPs fora de ordem ou duplicados. Ativação cancelada.');last=row.cep;cepHash.update(row.cep+'\n');processed++;
    batch.push({id:stableUuid(dataset,row.cep),cep:row.cep,city:row.city,state:row.state,available:true,importedFrom:dataset,importedAt:now});if(batch.length===2000)await flush();
  }
  await flush();if(processed!==manifest.uniqueCeps)throw new Error('Quantidade extraída não confere. Ativação cancelada.');
  const actualHash=createHash('sha256');let count=0,cursor='';
  while(true){const rows=await db.coverageCep.findMany({where:{importedFrom:dataset,deletedAt:null,available:true,cep:{gt:cursor}},orderBy:{cep:'asc'},take:5000,select:{cep:true}});if(!rows.length)break;for(const row of rows){actualHash.update(row.cep+'\n');count++;}cursor=rows.at(-1)!.cep;}
  const expectedHash=cepHash.digest('hex'),storedHash=actualHash.digest('hex');
  if(count!==processed||storedHash!==expectedHash||await db.coverageCep.count({where:{importedFrom:dataset}})!==processed)throw new Error('Conferência do banco falhou. Base não ativada.');
  const key=`coverage:dataset:${agent.id}`;
  await db.appSetting.upsert({where:{key},create:{key,value:{dataset,count,sourceHash:manifest.sourceHash,workbooks:manifest.files.length,ready:true,cepHash:expectedHash}},update:{value:{dataset,count,sourceHash:manifest.sourceHash,workbooks:manifest.files.length,ready:true,cepHash:expectedHash}}});
  if(activate){await db.$transaction(async tx=>{
    const before=await tx.agent.findUniqueOrThrow({where:{id:agent.id},include:{plans:{orderBy:{id:'asc'}}}});
    if(digit(before.zapiWhatsappNumber)!==targetNumber||before.zapiInstanceId!=='GIGA CLICK')throw new Error('Vínculo do número alterado. Base não ativada.');
    writeFileSync(`.backups/coverage-20261103/agent-before-activation-${Date.now()}.json`,JSON.stringify(before,null,2),{mode:0o600});
    const original=before.rules&&typeof before.rules==='object'&&!Array.isArray(before.rules)?before.rules as Record<string,Prisma.InputJsonValue>:{};
    const rules={...original,coveragePolicy:{mode:'required',dataset},cobertura:'Consultar exclusivamente a base de CEPs deste agente. Se o CEP estiver cadastrado com cobertura, continuar o fluxo atual. Se não estiver, informar que no momento ainda não temos cobertura e encerrar essa solicitação sem criar lead. Não citar nomes de operadoras nem confundir CEP localizado com instalação garantida.'};
    const updated=await tx.agent.updateMany({where:{id:before.id,updatedAt:before.updatedAt},data:{rules}});if(updated.count!==1)throw new Error('Edição concorrente do agente. Ativação revertida.');
    const after=await tx.agent.findUniqueOrThrow({where:{id:before.id},include:{plans:{orderBy:{id:'asc'}}}});
    const protect=(value:typeof before)=>{const {rules,updatedAt,...fields}=normalized(value);return fields;};
    if(JSON.stringify(protect(before))!==JSON.stringify(protect(after)))throw new Error('Campo protegido alterado. Ativação revertida.');
  },{timeout:30000});}
  const report={applied:true,activated:activate,instance:'GIGA CLICK',number:targetNumber,workbooks:manifest.files.length,sourceRows:manifest.dataRows,validRows:manifest.validRows,invalidRows:manifest.invalidRows,uniqueCeps:count,duplicates:manifest.duplicates,sourceHash:manifest.sourceHash,cepHash:expectedHash,dataset,plansPreserved:true,flowPreserved:true,customerMessagesSent:0};
  writeFileSync(`${folder}/import-result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Falha na importação.');process.exitCode=1;}).finally(()=>db.$disconnect());
