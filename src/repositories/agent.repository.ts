import { prisma } from "@/lib/prisma";
import type { CreateAgentInput, UpdateAgentInput } from "@/modules/n8n/types/agent";

export class AgentRepository {
  async findMany() {
    return prisma.agent.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { plans: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
    });
  }

  async create(data: CreateAgentInput) {
    const { planIds, ...agent } = data;
    await this.validateIsolation(planIds, agent.zapiInstanceId);
    return prisma.agent.create({
      data: {
        ...agent,
        rules: data.rules ?? {},
        flow: data.flow ?? {},
        plans: planIds?.length ? { connect: planIds.map((id) => ({ id })) } : undefined,
      },
      include: { plans: true },
    });
  }

  async update(id: string, data: UpdateAgentInput) {
    const { planIds, ...agent } = data;
    await this.validateIsolation(planIds, agent.zapiInstanceId, id);
    return prisma.agent.update({
      where: { id },
      data: {
        ...agent,
        plans: planIds ? { set: planIds.map((planId) => ({ id: planId })) } : undefined,
      },
      include: { plans: true },
    });
  }

  private async validateIsolation(planIds?: string[], instanceId?: string, agentId?: string) {
    if (planIds?.length) {
      const shared = await prisma.plan.count({ where: { id: { in: planIds }, agents: { some: agentId ? { id: { not: agentId } } : {} } } });
      if (shared) throw new Error("Cada agente deve ter seus próprios planos. Não vincule planos de outro agente.");
    }
    if (instanceId?.trim()) {
      const duplicate = await prisma.agent.count({ where: { zapiInstanceId: instanceId.trim(), deletedAt: null, ...(agentId ? { id: { not: agentId } } : {}) } });
      if (duplicate) throw new Error("Esta instância WhatsApp já pertence a outro agente.");
    }
  }

  async softDelete(id: string) {
    return prisma.agent.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }
}
