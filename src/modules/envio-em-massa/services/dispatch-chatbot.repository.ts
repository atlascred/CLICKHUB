import type { Prisma, PrismaClient } from "@prisma/client";
import { ChatbotRepository } from "@/repositories/chatbot.repository";
import { dispatchScope, recordObject } from "../lib/dispatch-policy";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Adapt the existing NIO engine without moving official messages into Evolution. */
export class DispatchChatbotRepository extends ChatbotRepository {
  private snapshot?: { state: string; memory: unknown; deletedAt?: Date | null };

  constructor(private readonly store: PrismaClient, private readonly threadId: string, private readonly nioAgentId: string, private readonly requestId: string) { super(store); }

  override async findOrCreateConversation(phone: string, agentId?: string) {
    if (agentId !== this.nioAgentId) throw new Error("O número oficial atende apenas NIO FIBRA.");
    const thread = await this.store.chatConversation.findFirst({ where: { ...dispatchScope(), id: this.threadId, phone }, include: { messages: { orderBy: { createdAt: "desc" }, take: 10 } } });
    if (!thread) throw new Error("Conversa oficial não encontrada.");
    this.snapshot = thread;
    return { ...thread, ...this.engineState(thread) };
  }

  private engineState(thread: { state: string; memory: unknown; deletedAt?: Date | null }) {
    const outer = recordObject(thread.memory), memory = recordObject(outer.nioBotMemory);
    return {
      state: thread.deletedAt || thread.state !== "DISPATCH_OPEN" ? "BLOCKED" : String(outer.nioBotState || "START"),
      memory: JSON.parse(JSON.stringify({ ...memory, ...(outer.dispatchBotPaused === true ? { humanTakeover: true } : {}) })) as Prisma.JsonValue,
    };
  }

  override async getConversationControl(id: string) {
    if (id !== this.threadId) throw new Error("Conversa oficial inválida.");
    const thread = await this.store.chatConversation.findUnique({ where: { id }, select: { state: true, memory: true, deletedAt: true } });
    return thread ? this.engineState(thread) : null;
  }

  override async finalizePendingReply(providerId: string) {
    const thread = await this.store.chatConversation.findFirst({ where: { ...dispatchScope(), id: this.threadId } });
    if (!thread || thread.state !== "DISPATCH_OPEN") return;
    const outer = recordObject(thread.memory), memory = recordObject(outer.nioBotMemory);
    if (outer.dispatchBotPaused || memory.humanTakeover || memory.blocked) return;
    const pending = memory.pendingBotReply;
    if (pending?.next && (pending.providerId === providerId || pending.batchIds?.includes(providerId))) {
      await this.updateConversation({ id: thread.id, ...pending.next });
    }
  }

  override async updateConversation(input: { id: string; state: string; memory: Prisma.InputJsonValue; leadId?: string }, readBack = true) {
    if (input.id !== this.threadId) throw new Error("Conversa oficial inválida.");
    for (let attempt = 0; attempt < 8; attempt++) {
      // A cached value is only a CAS precondition, never an unconditional write.
      // Any concurrent pause/tag/status change misses CAS and forces a fresh read.
      const thread = this.snapshot ?? await this.store.chatConversation.findFirst({ where: { ...dispatchScope(), id: input.id } });
      const outer = recordObject(thread?.memory), memory = recordObject(outer.nioBotMemory);
      if (!thread || thread.state !== "DISPATCH_OPEN" || outer.dispatchBotPaused || memory.humanTakeover || memory.blocked) throw new Error("Atendimento assumido ou bloqueado.");
      const next = recordObject(input.memory);
      const nextOuter = json({ ...outer, ...(next.name ? { name: next.name } : {}), nioBotState: input.state, nioBotMemory: next, nioAgentId: this.nioAgentId });
      const updated = await this.store.chatConversation.updateMany({ where: { id: input.id, state: "DISPATCH_OPEN", deletedAt: null, memory: { equals: json(outer) } }, data: {
        memory: nextOuter,
        ...(input.leadId ? { leadId: input.leadId } : {}), updatedAt: new Date(),
      } });
      if (updated.count) {
        this.snapshot = { ...thread, memory: nextOuter };
        return readBack ? this.store.chatConversation.findUnique({ where: { id: input.id } }) : null;
      }
      this.snapshot = undefined;
    }
    throw new Error("Conversa em atualização; aguarde uma nova tentativa.");
  }

  override async saveMessage(input: Parameters<ChatbotRepository["saveMessage"]>[0]) {
    if (input.direction !== "outbound") return super.saveMessage(input);
    // The official transport already saved the message and its Meta delivery ID.
    const saved = await this.store.chatMessage.findUnique({ where: { providerId: `meta-dispatch-request:bot:${this.requestId}` } });
    if (!saved || saved.conversationId !== this.threadId) throw new Error("Resposta oficial sem comprovante de envio.");
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.store.chatMessage.findUniqueOrThrow({ where: { id: saved.id } });
      const raw = recordObject(current.rawPayload);
      const updated = await this.store.chatMessage.updateMany({ where: { id: saved.id, rawPayload: { equals: json(raw) } }, data: { rawPayload: json({ ...raw, inReplyTo: recordObject(input.rawPayload).inReplyTo, chatbot: "nio" }) } });
      if (updated.count) return current;
    }
    throw new Error("Resposta oficial em atualização.");
  }

  override async createLeadFromChat(input: Parameters<ChatbotRepository["createLeadFromChat"]>[0]) {
    const lead = await super.createLeadFromChat(input);
    // Explicit origin preserves the NIO badge while agentId remains isolated.
    return this.store.lead.update({ where: { id: lead.id }, data: { source: "chatbot:click" } });
  }
}
