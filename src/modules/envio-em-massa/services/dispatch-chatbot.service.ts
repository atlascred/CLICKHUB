import "server-only";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ChatbotRepository } from "@/repositories/chatbot.repository";
import { CepRepository } from "@/repositories/cep.repository";
import { ChatbotEngineService } from "@/modules/chatbot/services/chatbot-engine.service";
import { isAutomaticReply } from "@/modules/chatbot/intelligence";
import { MessageBatchService } from "@/modules/chatbot/services/message-batch.service";
import { interpretIncomingMedia } from "@/modules/chatbot/services/incoming-media.service";
import { OpenAiService } from "@/services/openai/openai.service";
import { ZapiService } from "@/services/zapi/zapi.service";
import { downloadMetaMediaBytes } from "@/services/meta-whatsapp";
import { getOpenAiRuntimeConfig } from "@/lib/integration-config";
import { DispatchChatbotRepository } from "./dispatch-chatbot.repository";
import { dispatchConversations, type DispatchConversationsService } from "./dispatch-conversations.service";
import { dispatchScope, dispatchThreadId, incomingContent, metaEventDate, recordObject, serviceWindowOpen } from "../lib/dispatch-policy";

export class DispatchChatbotService {
  constructor(private readonly db: PrismaClient = prisma, private readonly dispatch: DispatchConversationsService = dispatchConversations, private readonly batch = new MessageBatchService(), private readonly ai = new OpenAiService(), private readonly cep = new CepRepository()) {}

  async process(message: Record<string, any>, phoneId: string) {
    if (!["text", "button", "interactive", "audio", "image", "document"].includes(message.type) || typeof message.id !== "string" || typeof message.from !== "string") return;
    if (!serviceWindowOpen(metaEventDate(message.timestamp))) return;
    const id = dispatchThreadId(phoneId, message.from);
    const thread = await this.db.chatConversation.findFirst({ where: { ...dispatchScope(), id } });
    const memory = recordObject(thread?.memory), botMemory = recordObject(memory.nioBotMemory);
    if (!thread || thread.state !== "DISPATCH_OPEN" || memory.dispatchBotPaused || botMemory.humanTakeover || botMemory.blocked || memory.nioBotState === "FINISHED") return;
    const providerId = `meta:${phoneId}:${message.id}`;
    const repository = new ChatbotRepository(this.db);
    const [agent, windowOpen, receipt] = await Promise.all([
      repository.getAgentByInstance("CLICK", true), this.dispatch.windowOpen(id), repository.findReplyReceipt(providerId),
    ]);
    if (!windowOpen) return;
    if (!agent) throw new Error("O agente NIO FIBRA não está disponível.");
    const repo = new DispatchChatbotRepository(this.db, id, agent.id, providerId);
    // Check durable receipts before interpreting attachments on redelivery.
    if (receipt) { await repo.finalizePendingReply(providerId); return; }
    // Start before media/AI/queue work, overlap the request, and always await it.
    const typing = isAutomaticReply(incomingContent(message)) ? Promise.resolve(false) : this.dispatch.typing(message.id).catch(() => false);
    try {
      let incoming: { message: string; extractedData?: import("@/services/openai/openai.service").ExtractedCustomerData } = { message: incomingContent(message) };
      if (["audio", "image", "document"].includes(message.type)) {
        const media = recordObject(message[message.type]);
        let mediaUrl: string | undefined;
        if ((await getOpenAiRuntimeConfig()).apiKey && /^\d+$/.test(String(media.id || ""))) {
          try {
            const file = await downloadMetaMediaBytes(String(media.id));
            mediaUrl = `data:${file.mimeType.split(";")[0]};base64,${Buffer.from(file.bytes).toString("base64")}`;
          } catch { /* Ask for text when the attachment cannot be interpreted. */ }
        }
        incoming = await interpretIncomingMedia(this.ai, { kind: message.type === "image" ? "imagem" : message.type === "document" ? "documento" : "audio", message: String(media.caption || ""), mediaUrl, mimeType: String(media.mime_type || ""), fileName: media.filename });
      }
      return await this.batch.accept(`meta-dispatch:${id}`, { providerId, body: incoming.message, extractedData: incoming.extractedData }, async messages => {
        const requestId = messages[0].providerId;
        const boundRepo = new DispatchChatbotRepository(this.db, id, agent.id, requestId);
        const engine = new ChatbotEngineService(this.cep, boundRepo, new ZapiService(), this.ai, { send: async ({ message: body }) => {
          // The engine checks takeover immediately before delivery; send rechecks it
          // after reserving the outbound message, so no extra duplicate read here.
          await typing;
          await this.dispatch.send({ threadId: id, requestId: `bot:${requestId}`, body, automated: true });
        } });
        return engine.processIncomingMessage({ phone: thread.phone, message: messages.map(m => m.body).join("\n"), providerId: requestId, batchMessages: messages, extractedData: messages.some(m => m.extractedData !== undefined) ? Object.assign({}, ...messages.map(m => m.extractedData ?? {})) : undefined, provider: "meta", resolvedAgent: agent });
      });
    } finally { await typing; }
  }
}
export const dispatchChatbot = new DispatchChatbotService();
