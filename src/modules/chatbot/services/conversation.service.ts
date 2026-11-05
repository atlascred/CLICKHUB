import type { LeadAccessUser } from "@/lib/lead-source-access";
import { ChatbotRepository } from "@/repositories/chatbot.repository";

export class ConversationService {
  constructor(private readonly chatbotRepository = new ChatbotRepository()) {}

  async list(agentId?: string, user?: LeadAccessUser) {
    return this.chatbotRepository.listConversations(agentId, user);
  }

  async get(id: string, user?: LeadAccessUser) {
    return this.chatbotRepository.findConversationById(id, user);
  }

  async create(input: { phone: string; name?: string; assignedTo?: string; tags?: unknown; ownerUserId?: string; agentId?: string }) {
    return this.chatbotRepository.createManualConversation(input);
  }

  async update(input: { id: string; name?: string; assignedTo?: string; tags?: unknown; state?: string; blocked?: boolean; humanTakeover?: boolean }, user?: LeadAccessUser) {
    const conversation = await this.get(input.id, user);
    if (!conversation) throw new Error("FORBIDDEN");
    const memory = (conversation.memory ?? {}) as Record<string, unknown>;
    if (input.humanTakeover === false && (memory.pendingBotReply as {sending?: boolean} | undefined)?.sending) throw new Error("Entrega incerta. Confira o histórico antes de liberar a automação.");
    return this.chatbotRepository.updateManualConversation(input);
  }

  async delete(id: string, user?: LeadAccessUser) {
    if (!await this.get(id, user)) throw new Error("FORBIDDEN");
    return this.chatbotRepository.softDeleteConversation(id);
  }
}
