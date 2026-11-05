// Run with --apply after deploying the authenticated follow-up endpoint.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = process.cwd();
require('tsx/cjs');
require('@next/env').loadEnvConfig(root);
const { prisma } = require('../src/lib/prisma.ts');
const key = 'chatbot:followup:settings';
const jobName = 'clickhub-conversations-follow-up';
const vaultName = 'clickhub_followup_cron_secret';
const endpoint = 'https://clickhub-peach.vercel.app/api/cron/conversations-follow-up';
const instances = process.argv.filter(value => value.startsWith('--instance=')).map(value => value.slice(11));
const apply = process.argv.includes('--apply');
async function main() {
  assert.ok(instances.length && instances.every(name => ['CLICK', 'GIGA CLICK'].includes(name)), 'Escolha as instâncias explicitamente.');
  const secret = process.env.CRON_SECRET?.trim();
  assert.ok(secret && secret.length >= 16, 'CRON_SECRET não configurado.');
  const probe = await fetch(endpoint + '?dryRun=1', { headers: { authorization: 'Bearer ' + secret }, signal: AbortSignal.timeout(20000) });
  const result = await probe.json();
  assert.ok(probe.ok && result.status === 'success' && result.data.dryRun === true, 'Endpoint publicado ou credencial não está pronto.');
  const agents = await prisma.agent.findMany({ where: { zapiInstanceId: { in: instances }, active: true, deletedAt: null }, select: { id: true, zapiInstanceId: true } });
  assert.equal(agents.length, new Set(instances).size, 'Instâncias sem agente único ativo.');
  if (!apply) { console.log(JSON.stringify({ dryRun: true, instances, intervalHours: 2, maxReminders: 3, scheduler: 'Supabase Cron', endpointReady: true })); return; }
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog');
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions');
  const command = `SELECT net.http_post(url := '${endpoint}', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${vaultName}')), body := '{}'::jsonb, timeout_milliseconds := 60000);`;
  const saved = await prisma.$transaction(async tx => {
    const prior = await tx.appSetting.findUnique({ where: { key } });
    const jobs = await tx.$queryRaw`SELECT jobid::text, schedule, command, active FROM cron.job WHERE jobname = ${jobName}`;
    fs.mkdirSync(root + '/.backups/follow-up', { recursive: true });
    fs.writeFileSync(root + '/.backups/follow-up/before-' + Date.now() + '.json', JSON.stringify({ setting: prior, jobs }), { mode: 0o600 });
    const existing = await tx.$queryRaw`SELECT id::text FROM vault.secrets WHERE name = ${vaultName}`;
    if (existing[0]) await tx.$queryRaw`SELECT vault.update_secret(${existing[0].id}::uuid, ${secret}, ${vaultName})::text`;
    else await tx.$queryRaw`SELECT vault.create_secret(${secret}, ${vaultName})::text`;
    const previous = prior?.value || {};
    const value = { enabled: true, instances: [...new Set(instances)], activatedAt: previous.enabled === true && previous.activatedAt ? previous.activatedAt : new Date().toISOString(), intervalHours: 2, maxReminders: 3 };
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await tx.$queryRaw`SELECT cron.schedule(${jobName}, '* * * * *', ${command})::text`;
    return value;
  }, { timeout: 30000 });
  const verified = await prisma.$queryRaw`SELECT active, schedule FROM cron.job WHERE jobname = ${jobName}`;
  assert.equal(verified[0].active, true); assert.equal(verified[0].schedule, '* * * * *');
  console.log(JSON.stringify({ applied: true, ...saved, scheduler: 'Supabase Cron', schedulerActive: true, customerMessagesSentByActivation: 0 }));
}
main().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
