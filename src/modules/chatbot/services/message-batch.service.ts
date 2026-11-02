import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { ExtractedCustomerData } from "@/services/openai/openai.service";

export type BufferedMessage = { providerId: string; body: string; rawPayload?: Prisma.InputJsonValue; extractedData?: ExtractedCustomerData };
export type BatchState = {
  pending: BufferedMessage[]; done: string[]; firstAt: number; lastAt: number;
  lease?: { token: string; until: number; messages: BufferedMessage[] };
};
export interface BatchStore {
  change<T>(key: string, edit: (state: BatchState) => T): Promise<T>;
}

/** AppSetting is already available: no schema migration or in-memory-only queue. */
export class PrismaBatchStore implements BatchStore {
  async change<T>(key: string, edit: (state: BatchState) => T): Promise<T> {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
      const row = await tx.appSetting.findUnique({ where: { key } });
      const state = row?.value as unknown as BatchState ?? { pending: [], done: [], firstAt: 0, lastAt: 0 };
      const result = edit(state);
      await tx.appSetting.upsert({ where: { key }, create: { key, value: JSON.parse(JSON.stringify(state)) }, update: { value: JSON.parse(JSON.stringify(state)) } });
      return result;
    }, { timeout: 10000 });
  }
}

export class MessageBatchService {
  constructor(private readonly store: BatchStore = new PrismaBatchStore(), private readonly windowMs = Math.max(100, Math.min(1500, Number(process.env.CHATBOT_BATCH_WINDOW_MS) || 900)),
    private readonly now = () => Date.now(), private readonly sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {}

  async accept(scope: string, message: BufferedMessage, process: (messages: BufferedMessage[]) => Promise<unknown>) {
    const key = `chatbot:batch:${createHash("sha256").update(scope).digest("hex")}`;
    await this.store.change(key, state => {
      if (state.done.includes(message.providerId) || state.pending.some(m => m.providerId === message.providerId) || state.lease?.messages.some(m => m.providerId === message.providerId)) return;
      if (!state.pending.length) state.firstAt = this.now();
      state.pending.push(message); state.lastAt = this.now();
    });
    const deadline = this.now() + 12000;
    while (this.now() <= deadline) {
      const claim = await this.store.change(key, state => {
        if (state.done.includes(message.providerId)) return { done: true };
        if (state.lease && state.lease.until <= this.now()) {
          state.pending.unshift(...state.lease.messages); state.lease = undefined;
        }
        if (state.lease || !state.pending.length || (this.now() - state.lastAt < this.windowMs && this.now() - state.firstAt < 3000)) return {};
        const lease = { token: randomUUID(), until: this.now() + 60000, messages: state.pending.splice(0) };
        state.lease = lease; return { lease };
      });
      if (claim.done) return { batched: true, duplicatedOrProcessed: true };
      if (claim.lease) {
        const lease = claim.lease;
        try {
          const result = await process(lease.messages);
          await this.store.change(key, state => {
            if (state.lease?.token !== lease.token) throw new Error("Lease da conversa expirou.");
            state.done = [...new Set([...state.done, ...lease.messages.map(m => m.providerId)])].slice(-100);
            state.lease = undefined;
          });
          if (lease.messages.some(m => m.providerId === message.providerId)) return result;
        } catch (error) {
          await this.store.change(key, state => {
            if (state.lease?.token === lease.token) { state.pending.unshift(...lease.messages); state.lease = undefined; }
          });
          throw error;
        }
      }
      await this.sleep(Math.max(5, Math.min(this.windowMs, 250)));
    }
    // Do not acknowledge a message that has only been queued. Provider can retry.
    throw new Error("Atendimento ocupado; tente novamente para retomar a mensagem persistida.");
  }
}
