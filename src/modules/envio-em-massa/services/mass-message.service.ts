import { normalizePhone } from "@/services/validators";
export function campaignContacts(text: string) {
  if (typeof text !== "string" || text.length > 20_000) throw new Error("Informe até 100 contatos por campanha.");
  const entries = text.split(/[\r\n;,]+/).map(v => v.trim()).filter(Boolean);
  if (entries.some(v => !/^55\d{10,11}$/.test(normalizePhone(v)))) throw new Error("Há números inválidos. Use DDD e número, um contato por linha.");
  const contacts = [...new Set(entries.map(normalizePhone))];
  if (!contacts.length || contacts.length > 100) throw new Error("Informe de 1 a 100 contatos por campanha.");
  return contacts;
}
export type RecipientStatus = "queued" | "sending" | "accepted" | "delivered" | "read" | "failed" | "uncertain";
export type Campaign = { id: string; ownerId: string; phoneNumberId: string; fingerprint: string; createdAt: string; template: any; recipients: Array<{ phone: string; status: RecipientStatus; messageId?: string; detail?: string; startedAt?: string }> };
export interface CampaignStore {
  get(id: string): Promise<Campaign | null>;
  create(campaign: Campaign): Promise<void>;
  replace(previous: Campaign, next: Campaign): Promise<boolean>;
}
export class MassMessageService {
  constructor(private readonly store: CampaignStore, private readonly sendOne: (phone: string, template: unknown, id: string) => Promise<string>) {}
  async read(id: string, ownerId: string) {
    const campaign = await this.store.get(id);
    if (!campaign || campaign.ownerId !== ownerId) throw new Error("Campanha não encontrada.");
    return campaign;
  }
  async next(id: string, ownerId: string, phoneNumberId: string) {
    const current = await this.read(id, ownerId);
    if (current.phoneNumberId !== phoneNumberId) throw new Error("O número oficial da campanha foi alterado. Revise a conexão.");
    const active = current.recipients.findIndex(r => r.status === "sending");
    if (active >= 0) {
      if (Date.now() - Date.parse(current.recipients[active].startedAt || current.createdAt) > 90_000) {
        const next = structuredClone(current);
        next.recipients[active].status = "uncertain";
        next.recipients[active].detail = "Envio interrompido sem confirmação. Confira na Meta antes de reenviar.";
        await this.store.replace(current, next);
      }
      return this.read(id, ownerId);
    }
    const index = current.recipients.findIndex(r => r.status === "queued");
    if (index < 0) return current;
    const claimed = structuredClone(current);
    claimed.recipients[index].status = "sending";
    claimed.recipients[index].startedAt = new Date().toISOString();
    // Atomic compare-and-swap: concurrent requests cannot claim the same recipient.
    if (!await this.store.replace(current, claimed)) return this.read(id, ownerId);
    let outcome: Partial<Campaign["recipients"][number]>;
    try {
      const messageId = await this.sendOne(claimed.recipients[index].phone, claimed.template, claimed.id);
      outcome = { status: "accepted", messageId, detail: "Aceita pela Meta; aguardando confirmação de entrega." };
    } catch (error) {
      const known = error instanceof Error && "uncertain" in error;
      outcome = { status: known && !(error as Error & { uncertain: boolean }).uncertain ? "failed" : "uncertain", detail: error instanceof Error ? error.message : "Sem confirmação da Meta. Confira antes de reenviar." };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const latest = await this.read(id, ownerId);
      const updated = structuredClone(latest);
      // A delivery webhook can arrive before the HTTP response; never downgrade it.
      if (["sending", "uncertain"].includes(updated.recipients[index].status)) Object.assign(updated.recipients[index], outcome);
      else if (outcome.messageId) updated.recipients[index].messageId = outcome.messageId;
      if (await this.store.replace(latest, updated)) return updated;
    }
    throw new Error("Atualize o resultado da campanha. O contato não será reenviado automaticamente.");
  }
}
