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
  constructor(private readonly db = prisma) {}

  async change<T>(key: string, edit: (state: BatchState) => T): Promise<T> {
    // Compare the entire prior JSON value atomically. A concurrent writer wins or
    // this operation retries; no read/modify/write transaction spans network hops.
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.db.appSetting.findUnique({ where: { key }, select: { value: true } });
      const before = row?.value;
      const state: BatchState = before ? JSON.parse(JSON.stringify(before)) : { pending: [], done: [], firstAt: 0, lastAt: 0 };
      const result = edit(state);
      const value = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
      if (row) {
        if (JSON.stringify(before) === JSON.stringify(value)) return result;
        const updated = await this.db.appSetting.updateMany({ where: { key, value: { equals: before as Prisma.InputJsonValue } }, data: { value } });
        if (updated.count) return result;
      } else {
        try { await this.db.appSetting.create({ data: { key, value } }); return result; }
        catch (error) { if ((error as { code?: string }).code !== "P2002") throw error; }
      }
    }
    throw new Error("Fila concorrente ocupada; reentrega necessária sem confirmar processamento.");
  }
}

export class MessageBatchService {
  constructor(private readonly store: BatchStore = new PrismaBatchStore(), private readonly windowMs = Math.max(100, Math.min(1500, Number(process.env.CHATBOT_BATCH_WINDOW_MS) || 300)),
    private readonly now = () => Date.now(), private readonly sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {}

  async accept(scope: string, message: BufferedMessage, process: (messages: BufferedMessage[]) => Promise<unknown>) {
    const key = `chatbot:batch:${createHash("sha256").update(scope).digest("hex")}`;
    const queued = await this.store.change(key, state => {
      if (state.done.includes(message.providerId)) return { done: true, waitMs: 0 };
      if (!state.pending.some(m => m.providerId === message.providerId) && !state.lease?.messages.some(m => m.providerId === message.providerId)) {
        if (!state.pending.length) state.firstAt = this.now();
        state.pending.push(message); state.lastAt = this.now();
      }
      return { done: false, waitMs: state.lease ? Math.min(this.windowMs, 250) : Math.max(0, this.windowMs - (this.now() - state.lastAt)) };
    });
    if (queued.done) return { batched: true, duplicatedOrProcessed: true };
    // Wait locally before checking storage; do not poll/write the database while
    // the intentional grouping window has not elapsed.
    if (queued.waitMs > 0) await this.sleep(queued.waitMs);
    const deadline = this.now() + 12000;
    while (this.now() <= deadline) {
      const claim = await this.store.change(key, state => {
        if (state.done.includes(message.providerId)) return { done: true };
        if (state.lease && state.lease.until <= this.now()) {
          state.pending.unshift(...state.lease.messages); state.lease = undefined;
        }
        if (state.lease || !state.pending.length) return { waitMs: Math.min(this.windowMs, 250) };
        if (this.now() - state.lastAt < this.windowMs && this.now() - state.firstAt < 3000) return { waitMs: Math.max(5, this.windowMs - (this.now() - state.lastAt)) };
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
      await this.sleep(claim.waitMs ?? Math.max(5, Math.min(this.windowMs, 250)));
    }
    // Do not acknowledge a message that has only been queued. Provider can retry.
    throw new Error("Atendimento ocupado; tente novamente para retomar a mensagem persistida.");
  }
}
