import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveEvolutionInstance } from "./evolution-context";

export async function resolveSelectedAgent(agentId?: string) {
  if (agentId) {
    const agent = await prisma.agent.findFirst({ where: { id: agentId, active: true, deletedAt: null } });
    if (!agent?.zapiInstanceId) throw new Error("Agente sem instância WhatsApp configurada.");
    resolveEvolutionInstance(agent.zapiInstanceId);
    const bindings = await prisma.agent.count({ where: { active: true, deletedAt: null, zapiInstanceId: agent.zapiInstanceId } });
    if (bindings !== 1) throw new Error("Instância vinculada a mais de um agente. Envio bloqueado.");
    return agent;
  }
  const agents = await prisma.agent.findMany({ where: { active: true, deletedAt: null }, take: 2 });
  if (agents.length !== 1 || !agents[0].zapiInstanceId) throw new Error("Selecione o agente CLICK ou GIGA CLICK antes de enviar.");
  resolveEvolutionInstance(agents[0].zapiInstanceId);
  return agents[0];
}
