import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/services/validators";
import { OfficialMetaClient, MetaRequestError } from "./official-meta.service";
import { dispatchScope, dispatchThreadId, DISPATCH_SOURCE, incomingContent, metaEventDate, recordObject, serviceWindowOpen } from "../lib/dispatch-policy";
import type { Campaign } from "./mass-message.service";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export class DispatchConversationsService {
  constructor(private readonly db: PrismaClient = prisma, private readonly meta = new OfficialMetaClient()) {}
  async ensureThread(phone: string, phoneId: string, ownerUserId?: string, name?: string) {
    const id = dispatchThreadId(phoneId, phone);
    return this.db.chatConversation.upsert({ where: { id }, create: { id, phone, agentId: null, ownerUserId, state: "DISPATCH_OPEN", memory: { source: DISPATCH_SOURCE, metaPhoneId: phoneId, name: name || phone } }, update: { updatedAt: new Date(), deletedAt: null } });
  }
  async receive(message: Record<string, any>, contacts: Array<Record<string, any>>, phoneId: string) {
    const phone = normalizePhone(String(message.from || ""));
    if (!/^55\d{10,11}$/.test(phone) || typeof message.id !== "string" || !message.id) return;
    const providerId = `meta:${phoneId}:${message.id}`;
    const contact = contacts.find(contact => contact.wa_id === message.from);
    try {
      await this.db.$transaction(async tx => {
        if (await tx.chatMessage.findUnique({ where: { providerId }, select: { id: true } })) return;
        const id = dispatchThreadId(phoneId, phone);
        await tx.chatConversation.upsert({ where: { id }, create: { id, phone, agentId: null, state: "DISPATCH_OPEN", memory: { source: DISPATCH_SOURCE, metaPhoneId: phoneId, name: String(contact?.profile?.name || phone).slice(0, 120) } }, update: { updatedAt: new Date(), deletedAt: null } });
        const messageId = randomUUID();
        const media = ["image", "audio", "video", "document", "sticker"].includes(message.type) ? recordObject(message[message.type]) : null;
        const body = media?.id ? JSON.stringify({ kind: "media", mediaKind: message.type === "sticker" ? "image" : message.type, fileName: String(media.filename || message.type), mimeType: String(media.mime_type || "application/octet-stream"), dataUrl: `/api/envio-em-massa/conversas/midia?id=${messageId}`, caption: media.caption || "" }) : incomingContent(message);
        await tx.chatMessage.create({ data: { id: messageId, conversationId: id, direction: "inbound", providerId, body, createdAt: metaEventDate(message.timestamp), rawPayload: json({ provider: "meta-dispatch", metaMessageId: message.id, metaPhoneId: phoneId, ...(media?.id ? { mediaId: media.id } : {}) }) } });
      });
    } catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error; }
  }
  async typing(messageId: string) { return this.meta.typing(messageId); }
  async windowOpen(conversationId: string) {
    const last = await this.db.chatMessage.findFirst({ where: { conversationId, direction: "inbound" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    return serviceWindowOpen(last?.createdAt);
  }
  async assertTextRecipients(phones: string[], user: { id: string; role: string }) {
    const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID!.trim();
    const threads = await this.db.chatConversation.findMany({ where: { ...dispatchScope(user), id: { in: phones.map(phone => dispatchThreadId(phoneId, phone)) } }, select: { id: true, state: true, messages: { where: { direction: "inbound" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } });
    if (threads.length !== phones.length || threads.some(t => t.state === "DISPATCH_BLOCKED" || !serviceWindowOpen(t.messages[0]?.createdAt))) throw new Error("Texto livre exige resposta do cliente nas últimas 24 horas e uma conversa acessível, sem bloqueio. Use um modelo aprovado para iniciar o contato.");
  }
  async campaignRecipient(campaign: Campaign, phone: string) {
    const thread = await this.ensureThread(phone, campaign.phoneNumberId, campaign.ownerId);
    const content = campaign.mode === "text" ? { type: "text", text: { body: campaign.messageBody || "" } } : { type: "template", template: campaign.template, biz_opaque_callback_data: `${campaign.id}:${phone}` };
    return this.send({ threadId: thread.id, requestId: `${campaign.id}:${phone}`, body: campaign.messageBody || `Modelo: ${campaign.template?.name || "Mensagem aprovada"}`, content, requireWindow: campaign.mode === "text", campaignId: campaign.id });
  }
  async send(input: { threadId: string; requestId: string; body: string; content?: Record<string, unknown>; file?: File; requireWindow?: boolean; campaignId?: string; automated?: boolean }) {
    const thread = await this.db.chatConversation.findFirst({ where: { ...dispatchScope(), id: input.threadId } });
    if (!thread) throw new MetaRequestError("Conversa oficial não encontrada.", false);
    if (thread.state === "DISPATCH_BLOCKED") throw new MetaRequestError("Contato bloqueado. Desbloqueie antes de enviar.", false);
    if (input.requireWindow !== false && !await this.windowOpen(thread.id)) throw new MetaRequestError("A janela de atendimento de 24 horas está fechada. Envie um modelo aprovado ou aguarde uma resposta do cliente.", false);
    const requestKey = `meta-dispatch-request:${input.requestId}`;
    const messageId = randomUUID();
    const raw = { provider: "meta-dispatch", metaPhoneId: process.env.META_WHATSAPP_PHONE_NUMBER_ID, state: "sending", ...(input.campaignId ? { campaignId: input.campaignId } : {}) };
    try { await this.db.chatMessage.create({ data: { id: messageId, conversationId: thread.id, providerId: requestKey, direction: "outbound", body: input.body, rawPayload: json(raw) } }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      const saved = await this.db.chatMessage.findUnique({ where: { providerId: requestKey } });
      const previous = recordObject(saved?.rawPayload);
      if (saved?.conversationId !== thread.id) throw new Error("Solicitação já utilizada.");
      if (previous.metaMessageId) return String(previous.metaMessageId);
      throw new MetaRequestError(previous.state === "failed" ? "Esta tentativa já falhou. Confira o histórico antes de criar um novo envio." : "Envio já iniciado ou sem confirmação. Confira o histórico antes de reenviar.", true);
    }
    let body = input.body;
    let mediaId: string | undefined;
    let nativeId: string | undefined;
    try {
      if (input.automated) {
        const latest = await this.db.chatConversation.findFirst({ where: { ...dispatchScope(), id: thread.id } });
        const memory = recordObject(latest?.memory), bot = recordObject(memory.nioBotMemory);
        if (!latest || latest.state !== "DISPATCH_OPEN" || memory.dispatchBotPaused || bot.humanTakeover || bot.blocked) throw new MetaRequestError("Chatbot pausado ou contato bloqueado.", false);
      }
      let content = input.content || { type: "text", text: { body: input.body } };
      if (input.file) {
        mediaId = await this.meta.upload(input.file);
        const kind = input.file.type.startsWith("image/") ? "image" : input.file.type.startsWith("video/") ? "video" : input.file.type.startsWith("audio/") ? "audio" : "document";
        content = { type: kind, [kind]: { id: mediaId, ...(kind === "document" ? { filename: input.file.name } : {}), ...(kind !== "audio" && input.body ? { caption: input.body } : {}) } };
        body = JSON.stringify({ kind: "media", mediaKind: kind, fileName: input.file.name, mimeType: input.file.type, dataUrl: `/api/envio-em-massa/conversas/midia?id=${messageId}`, caption: input.body });
      }
      nativeId = await this.meta.sendContent(thread.phone, { ...content, biz_opaque_callback_data: content.biz_opaque_callback_data || `dispatch:${messageId}` });
      let saved = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await this.db.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
        const latest = recordObject(current.rawPayload);
        const state = ["sent","delivered","read"].includes(latest.state) ? latest.state : "accepted";
        const result = await this.db.chatMessage.updateMany({ where: { id: messageId, rawPayload: { equals: json(latest) } }, data: { body, sentAt: new Date(), rawPayload: json({ ...latest, state, metaMessageId: nativeId, mediaId }) } });
        if (result.count) { saved = true; break; }
      }
      if (!saved) throw new MetaRequestError("Envio aceito, mas o registro está em atualização. Confira o histórico.", true);
      await this.db.chatConversation.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      return nativeId;
    } catch (error) {
      const uncertain = Boolean(nativeId) || !(error instanceof MetaRequestError) || error.uncertain;
      const saved = await this.db.chatMessage.findUnique({ where: { id: messageId } }).catch(() => null);
      const latest = recordObject(saved?.rawPayload);
      const state = ["sent","delivered","read"].includes(latest.state) ? latest.state : uncertain ? "uncertain" : "failed";
      await this.db.chatMessage.update({ where: { id: messageId }, data: { body, rawPayload: json({ ...raw, ...latest, mediaId, metaMessageId: nativeId || latest.metaMessageId, state }) } }).catch(() => {});
      throw new MetaRequestError(error instanceof Error ? error.message : "Não foi possível confirmar o envio.", uncertain);
    }
  }
  async status(status: Record<string, any>, phoneId: string) {
    if (typeof status.id !== "string") return;
    let message = await this.db.chatMessage.findFirst({ where: { direction: "outbound", conversation: { ...dispatchScope(), memory: { path: ["metaPhoneId"], equals: phoneId } }, rawPayload: { path: ["metaMessageId"], equals: status.id } } });
    if (!message && typeof status.biz_opaque_callback_data === "string") {
      const callback = status.biz_opaque_callback_data;
      const [first, second] = callback.split(":");
      const where = first === "dispatch" && /^[0-9a-f-]{36}$/i.test(second || "") ? { id: second }
        : /^[0-9a-f-]{36}$/i.test(first || "") && /^55\d{10,11}$/.test(second || "") ? { providerId: `meta-dispatch-request:${first}:${second}` } : null;
      if (where) message = await this.db.chatMessage.findFirst({ where: { ...where, direction: "outbound", conversation: { ...dispatchScope(), memory: { path: ["metaPhoneId"], equals: phoneId } } } });
    }
    if (!message) return;
    const ranks: Record<string, number> = { sending: 0, uncertain: 0, failed: 1, accepted: 2, sent: 2, delivered: 3, read: 4 };
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.db.chatMessage.findUnique({ where: { id: message.id } }); if (!current) return;
      const raw = recordObject(current.rawPayload);
      if (!(status.status in ranks) || (status.status === "failed" && ["delivered", "read"].includes(raw.state)) || (status.status !== "failed" && ranks[status.status] <= (ranks[raw.state] ?? 0))) return;
      const updated = await this.db.chatMessage.updateMany({ where: { id: message.id, rawPayload: { equals: json(raw) } }, data: { rawPayload: json({ ...raw, metaMessageId: status.id, state: status.status, statusAt: metaEventDate(status.timestamp).toISOString() }), ...(status.status === "read" ? { readAt: new Date() } : {}) } });
      if (updated.count) return;
    }
    throw new Error("Atualização de entrega concorrente; aguardar nova tentativa do webhook.");
  }
}
export const dispatchConversations = new DispatchConversationsService();
