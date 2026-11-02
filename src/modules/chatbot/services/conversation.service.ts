import { ChatbotRepository } from "@/repositories/chatbot.repository";

export class ConversationService {
  constructor(private readonly chatbotRepository = new ChatbotRepository()) {}

  async list(agentId?: string) {
    return this.chatbotRepository.listConversations(agentId);
  }

  async get(id: string) {
    return this.chatbotRepository.findConversationById(id);
  }

  async create(input: { phone: string; name?: string; assignedTo?: string; tags?: unknown; ownerUserId?: string; agentId?: string }) {
    return this.chatbotRepository.createManualConversation(input);
  }

  async update(input: { id: string; name?: string; assignedTo?: string; tags?: unknown; state?: string; blocked?: boolean; humanTakeover?: boolean }) {
    return this.chatbotRepository.updateManualConversation(input);
  }

  async delete(id: string) {
    return this.chatbotRepository.softDeleteConversation(id);
  }
}
