import type { Prisma, PrismaClient } from "@prisma/client";
import { dispatchScope, recordObject } from "../lib/dispatch-policy";

export async function setDispatchBotPaused(db: PrismaClient, id: string, paused: boolean) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const thread = await db.chatConversation.findFirst({ where: { ...dispatchScope(), id } });
    if (!thread) throw new Error("Conversa oficial não encontrada.");
    const memory = recordObject(thread.memory);
    if (!paused && thread.state !== "DISPATCH_OPEN") throw new Error("Abra e desbloqueie a conversa antes de retomar o chatbot.");
    const botMemory = recordObject(memory.nioBotMemory);
    const next = { ...memory, dispatchBotPaused: paused, ...(!paused ? { nioBotMemory: { ...botMemory, humanTakeover: false, blocked: false, pendingBotReply: null, takeoverAt: null, takeoverReason: null } } : {}) };
    const result = await db.chatConversation.updateMany({ where: { id, state: thread.state, deletedAt: null, memory: { equals: memory as Prisma.InputJsonValue } }, data: { memory: JSON.parse(JSON.stringify(next)), updatedAt: new Date() } });
    if (result.count) return;
  }
  throw new Error("Conversa em atualização. Tente novamente.");
}
