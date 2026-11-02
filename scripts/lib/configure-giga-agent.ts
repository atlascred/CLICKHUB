import type { PrismaClient } from "@prisma/client";
import { gigaCommercialPlans } from "./giga-commercial-plans";

export async function configureGigaAgent(db: PrismaClient, options: { apply: boolean; primaryNumber: string; gigaNumber: string }) {
  const agents = await db.agent.findMany({ where: { deletedAt: null }, include: { plans: true } });
  const primaryCandidates = agents.filter(a => a.zapiInstanceId === "CLICK" || (!a.zapiInstanceId && a.name === "Lily"));
  const gigaCandidates = agents.filter(a => a.zapiInstanceId === "GIGA CLICK");
  if (primaryCandidates.length !== 1 || gigaCandidates.length > 1) throw new Error("Identificação ambígua dos agentes. Nenhuma alteração aplicada.");
  const primary = primaryCandidates[0];
  if (!options.apply) return { dryRun: true, primary: { id: primary.id, instance: primary.zapiInstanceId || "CLICK", plans: primary.plans.map(p => ({ id: p.id, name: p.name, price: Number(p.price) })) }, secondary: { instance: "GIGA CLICK", existing: gigaCandidates.length === 1, plans: gigaCommercialPlans } };

  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('chatbot:agent-bindings'))::text`;
    // The primary catalog, personality, history and credentials are untouched.
    if (!primary.zapiInstanceId) await tx.agent.update({ where: { id: primary.id }, data: { zapiInstanceId: "CLICK", zapiWhatsappNumber: options.primaryNumber } });
    const registered = await tx.agent.findMany({ where: { zapiInstanceId: "GIGA CLICK", deletedAt: null }, include: { plans: true } });
    if (registered.length > 1) throw new Error("Instância GIGA CLICK duplicada. Operação cancelada.");
    let giga = registered[0];
    if (!giga) await tx.chatConversation.updateMany({ where: { agentId: null }, data: { agentId: primary.id } });
    if (!giga) giga = await tx.agent.create({ data: {
      name: primary.name, gender: primary.gender, personality: primary.personality,
      rules: JSON.parse(JSON.stringify(primary.rules)), flow: JSON.parse(JSON.stringify(primary.flow)),
      active: true, minTypingSeconds: primary.minTypingSeconds, maxTypingSeconds: primary.maxTypingSeconds,
      enableReadReceipt: primary.enableReadReceipt, enableTyping: primary.enableTyping, enableReplyDelay: primary.enableReplyDelay,
      openAiModel: primary.openAiModel, zapiInstanceId: "GIGA CLICK", zapiWhatsappNumber: options.gigaNumber,
      // Never clone any of the first agent's credential fields.
      zapiToken: null, zapiClientToken: null, zapiBaseUrl: null,
    }, include: { plans: true } });
    const ids: string[] = [];
    for (const plan of gigaCommercialPlans) {
      const existing = await tx.plan.findFirst({ where: { name: plan.name, deletedAt: null, agents: { some: { id: giga.id } } }, include: { agents: { select: { id: true } } } });
      if (existing?.agents.some(a => a.id !== giga.id)) throw new Error("Plano da GIGA compartilhado com outro agente; operação cancelada.");
      const saved = existing
        ? await tx.plan.update({ where: { id: existing.id }, data: { ...plan, active: true } })
        : await tx.plan.create({ data: { ...plan, active: true, agents: { connect: { id: giga.id } } } });
      ids.push(saved.id);
    }
    await tx.agent.update({ where: { id: giga.id }, data: { plans: { set: ids.map(id => ({ id })) } } });
    return { dryRun: false, primaryAgentId: primary.id, gigaAgentId: giga.id, gigaPlanIds: ids, primaryCatalogChanged: false };
  }, { timeout: 30000 });
}
