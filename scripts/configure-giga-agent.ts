import { prisma } from "@/lib/prisma";
import { configureGigaAgent } from "./lib/configure-giga-agent";
import { activateGigaWebhook } from "./lib/activate-giga-webhook";
import { resolveEvolutionInstance } from "@/services/evolution-context";

async function main() {
  const apply = process.argv.includes("--apply");
  const activate = process.argv.includes("--activate-webhook");
  if (activate && !apply) throw new Error("Ativação exige --apply e a publicação revisada.");
  const result = await configureGigaAgent(prisma, { apply, primaryNumber: process.env.EVOLUTION_DEFAULT_NUMBER || "", gigaNumber: "5511966271717" });
  console.log(JSON.stringify(result, null, 2));
  if (!activate) return;
  const webhookUrl = "https://clickhub-peach.vercel.app/api/whatsapp/webhook/instances/GIGA%20CLICK";
  const config = resolveEvolutionInstance("GIGA CLICK");
  await activateGigaWebhook(config, webhookUrl);
  console.log("Webhook da GIGA CLICK ativado sem alterar o webhook da CLICK.");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Falha na configuração."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
