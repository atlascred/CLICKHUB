import { prisma } from "@/lib/prisma";
import type { CreatePlanInput, UpdatePlanInput } from "@/modules/n8n/types/plan";

export class PlanRepository {
  async findMany() {
    return prisma.plan.findMany({
      where: { deletedAt: null },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: { agents: { select: { id: true } } },
    });
  }

  async findActive() {
    return prisma.plan.findMany({
      where: { deletedAt: null, active: true },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: { agents: { select: { id: true } } },
    });
  }

  async create(data: CreatePlanInput) {
    const { agentId, ...plan } = data;
    if (!agentId && await prisma.agent.count({ where: { active: true, deletedAt: null } }) > 1) throw new Error("Selecione o agente para cadastrar o plano.");
    return prisma.plan.create({ data: { ...plan, speed: data.speed ?? "", agents: agentId ? { connect: { id: agentId } } : undefined } });
  }

  async update(id: string, data: UpdatePlanInput) {
    const { agentId, ...plan } = data;
    const existing = await prisma.plan.findUnique({ where: { id }, include: { agents: { select: { id: true } } } });
    if (existing && (existing.agents.length > 1 || (agentId && existing.agents.length && !existing.agents.some(a => a.id === agentId)))) throw new Error("Plano vinculado a outro agente. Crie um plano separado.");
    return prisma.plan.update({ where: { id }, data: plan });
  }

  async softDelete(id: string) {
    const links = await prisma.agent.count({ where: { plans: { some: { id } }, deletedAt: null } });
    if (links > 1) throw new Error("Plano compartilhado: separe o catálogo antes de excluir.");
    return prisma.plan.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }
}
