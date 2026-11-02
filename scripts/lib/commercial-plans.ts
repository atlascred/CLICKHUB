import type { PrismaClient } from "@prisma/client";

export const commercialPlans = [
  {
    name: "600 MEGA",
    speed: "600 Mega",
    price: 55,
    description: "Internet Fibra 600 Mega\nRoteador Wi-Fi 5",
    order: 1,
  },
  {
    name: "800 MEGA",
    speed: "800 Mega",
    price: 70,
    description: "Internet Fibra 800 Mega\nRoteador Wi-Fi 6\nCHIP 10 GB de internet 5G\nChamadas ilimitadas",
    order: 2,
  },
  {
    name: "1 GIGA",
    speed: "1 Giga",
    price: 85,
    description: "Internet Fibra 1 Giga\nRoteador Wi-Fi 6\nCHIP 20 GB de internet 5G\nChamadas ilimitadas\nGloboplay por 12 meses por nossa conta",
    order: 3,
  },
];

export async function syncCommercialPlans(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    const instance = process.env.EVOLUTION_INSTANCE || "CLICK";
    const bound = await tx.agent.findMany({ where: { zapiInstanceId: instance, deletedAt: null }, select: { id: true } });
    const legacy = bound.length ? [] : await tx.agent.findMany({ where: { name: "Lily", deletedAt: null, OR: [{ zapiInstanceId: null }, { zapiInstanceId: "" }] }, select: { id: true } });
    const agents = bound.length ? bound : legacy;
    if (agents.length !== 1) throw new Error("Identifique exatamente um agente principal antes de sincronizar planos.");
    const agentId = agents[0].id;
    if (!bound.length) await tx.agent.update({ where: { id: agentId }, data: { zapiInstanceId: instance } });
    const shared = await tx.plan.count({ where: { agents: { some: { id: agentId } }, AND: [{ agents: { some: { id: { not: agentId } } } }] } });
    if (shared) throw new Error("Catálogo compartilhado com outro agente; sincronização bloqueada.");
    const ids: string[] = [];
    for (const plan of commercialPlans) {
      const existing = await tx.plan.findFirst({
        where: { name: { equals: plan.name, mode: "insensitive" }, deletedAt: null, agents: { some: { id: agentId } } },
        select: { id: true },
      });
      const data = { ...plan, active: true, deletedAt: null };
      const saved = existing
        ? await tx.plan.update({ where: { id: existing.id }, data })
        : await tx.plan.create({ data: { ...data, agents: { connect: { id: agentId } } } });
      ids.push(saved.id);
    }

    await tx.plan.updateMany({
      where: { id: { notIn: ids }, deletedAt: null, agents: { some: { id: agentId } } },
      data: { active: false, deletedAt: new Date() },
    });

    for (const agent of agents) {
      await tx.agent.update({
        where: { id: agent.id },
        data: { plans: { set: ids.map((id) => ({ id })) } },
      });
    }

    return tx.plan.findMany({
      where: { id: { in: ids } },
      orderBy: { order: "asc" },
      select: { id: true, name: true, speed: true, price: true, description: true },
    });
  }, { timeout: 30000 });
}
