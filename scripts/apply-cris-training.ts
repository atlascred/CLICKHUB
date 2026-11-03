import { PrismaClient, type Prisma } from "@prisma/client";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { crisTrainingFor, crisTrainingVersion } from "./lib/cris-training";

const db = new PrismaClient();
const instances = ["CLICK", "GIGA CLICK"];
const apply = process.argv.includes("--apply");
const serial = (value: unknown) => JSON.stringify(value);
const protectedAgent = (agent: Record<string, unknown>) => {
  const { personality: _personality, rules: _rules, updatedAt: _updatedAt, ...protectedFields } = agent;
  return protectedFields;
};

async function main() {
  const result = await db.$transaction(async tx => {
    if (apply) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('clickhub:cris-training'))::text`;
    const agents = await tx.agent.findMany({ where: { zapiInstanceId: { in: instances }, deletedAt: null }, include: { plans: { orderBy: { id: "asc" } } } });
    if (agents.length !== 2 || instances.some(instance => agents.filter(agent => agent.zapiInstanceId === instance).length !== 1)) throw new Error("Instâncias ausentes ou duplicadas. Nada alterado.");
    if (apply) {
      const folder = ".backups/cris-training-20261103";
      mkdirSync(folder, { recursive: true });
      const backup = `${folder}/agents-before-apply-${Date.now()}.json`;
      writeFileSync(backup, serial(agents), { mode: 0o600 }); chmodSync(backup, 0o600);
    }
    const changes = [];
    for (const agent of agents) {
      const training = crisTrainingFor(agent);
      if (apply) {
        const updated = await tx.agent.updateMany({ where: { id: agent.id, updatedAt: agent.updatedAt }, data: {
          personality: training.personality, rules: JSON.parse(serial(training.rules)) as Prisma.InputJsonValue,
        } });
        if (updated.count !== 1) throw new Error("Agente alterado simultaneamente. Operação revertida.");
        const after = await tx.agent.findUniqueOrThrow({ where: { id: agent.id }, include: { plans: { orderBy: { id: "asc" } } } });
        if (serial(protectedAgent(agent)) !== serial(protectedAgent(after))) throw new Error("Campo protegido mudou. Operação revertida.");
        if (serial(after.rules) !== serial(JSON.parse(serial(training.rules)))) {
          // PostgreSQL JSONB reorders keys; compare each rule instead of object order.
          for (const [key, value] of Object.entries(training.rules)) if (serial((after.rules as Record<string,unknown>)[key]) !== serial(value)) throw new Error("Regra não persistida. Operação revertida.");
        }
      }
      changes.push({ instance: agent.zapiInstanceId, name: agent.name, rules: Object.keys(training.rules).length,
        flowPreserved: true, plansPreserved: true, credentialsPreserved: true,
        trainingHash: createHash("sha256").update(serial(training)).digest("hex") });
    }
    return { version: crisTrainingVersion, applied: apply, fieldsUpdated: ["personality", "rules"], agents: changes, customerMessagesSent: 0 };
  }, { timeout: 60000 });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Falha no treinamento."); process.exitCode = 1; }).finally(() => db.$disconnect());
