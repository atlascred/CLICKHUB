import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const orderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200).refine(ids => new Set(ids).size === ids.length, "Categorias repetidas."),
});
export class StageOrderConflict extends Error {}

export async function reorderLeadStages(input: unknown, db: Pick<PrismaClient, "$transaction"> = prisma) {
  const { ids } = orderSchema.parse(input);
  return db.$transaction(async tx => {
    const active = await tx.leadKanbanStage.findMany({ where: { active: true, deletedAt: null }, select: { id: true } });
    const requested = new Set(ids);
    if (active.length !== ids.length || active.some(stage => !requested.has(stage.id))) {
      throw new StageOrderConflict("As categorias mudaram. Atualize o quadro e organize novamente.");
    }
    for (const [index, id] of ids.entries()) {
      await tx.leadKanbanStage.update({ where: { id }, data: { order: (index + 1) * 10 } });
    }
    return tx.leadKanbanStage.findMany({ where: { active: true, deletedAt: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}
