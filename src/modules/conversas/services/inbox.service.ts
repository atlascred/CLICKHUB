import { attachmentForMessage } from "@/lib/whatsapp-media";
import { InboxRepository } from "@/repositories/inbox.repository";
import type { LeadAccessUser } from "@/lib/lead-source-access";

type ConversationMemory = {
  tags?: ConversationTag[];
  awaitingFlowState?: string;
  followUpStage?: number;
  followUpLastSentAt?: string;
  followUpClosedAt?: string;
  [key: string]: unknown;
};

export type ConversationTag = {
  label: string;
  color: string;
};

const DEFAULT_TAG_COLOR = "sky";

export class InboxService {
  constructor(
    private readonly chatbotRepository = new InboxRepository(),
  ) {}

  async list(params?: {
    offset?: number;
    limit?: number;
    user?: LeadAccessUser;
    agentScope?: string;
    filter?: "all" | "unavailable" | "finished" | "stalled";
    includeSummary?: boolean;
  }) {
    const filter = params?.filter ?? "all";
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 25;
    const shouldFilterManually = filter !== "all";
    // First-page requests do not need to scan the entire inbox for badge counts.
    const summaryRows = shouldFilterManually || params?.includeSummary !== false
      ? await this.getSummaryRows(params?.user, params?.agentScope)
      : null;
    const summary = summaryRows ? buildConversationSummary(summaryRows) : undefined;
    const matchingRows = shouldFilterManually ? summaryRows!.filter((row) => matchesConversationFilter({
      state: row.state, isStalled: getConversationFlowStatus(row).isStalled,
    }, filter)) : null;
    const [conversations, total] = await Promise.all([
      this.chatbotRepository.listConversations({
        skip: shouldFilterManually ? 0 : offset,
        take: limit,
        ...(matchingRows ? { ids: matchingRows.slice(offset, offset + limit).map((row) => row.id) } : {}),
        user: params?.user,
        agentScope: params?.agentScope,
      }),
      matchingRows ? Promise.resolve(matchingRows.length)
        : summaryRows ? Promise.resolve(summaryRows.length)
        : this.chatbotRepository.countConversations(params?.user, params?.agentScope),
    ]);

    const allItems = conversations.map((conversation) => {
      const memory = this.parseMemory(conversation.memory);
      const lastMessage = conversation.messages[0] ?? null;
      const latestInboundAt = conversation.messages.find((message) => message.direction === "inbound")?.createdAt ?? null;
      const latestOutboundAt = conversation.messages.find((message) => message.direction === "outbound")?.createdAt ?? null;
      const hasPendingCustomerMessage = Boolean(
        latestInboundAt && (!latestOutboundAt || latestInboundAt.getTime() > latestOutboundAt.getTime()),
      );
      const liveStatus = getConversationFlowStatus({
        state: conversation.state,
        memory,
        ownerUserId: conversation.ownerUserId,
        updatedAt: conversation.updatedAt.toISOString(),
        messages: conversation.messages.map((message) => ({
          direction: message.direction,
          createdAt: message.createdAt.toISOString(),
        })),
      });

      return {
        id: conversation.id,
        phone: conversation.phone,
        contactName: typeof memory.contactName === "string" ? memory.contactName : null,
        state: conversation.state,
        updatedAt: conversation.updatedAt.toISOString(),
        lead: conversation.lead ? { id: conversation.lead.id, name: conversation.lead.name } : null,
        agent: conversation.agent ? { id: conversation.agent.id, name: conversation.agent.name } : null,
        owner: conversation.owner ? { id: conversation.owner.id, name: conversation.owner.name, role: conversation.owner.role } : null,
        tags: memory.tags ?? [],
        botActive: !conversation.ownerUserId && memory.humanTakeover !== true && memory.blocked !== true && !["MANUAL", "BLOCKED", "HUMAN_HANDOFF", "FINISHED"].includes(conversation.state),
        isStalled: liveStatus.isStalled,
        stalledStageLabel: liveStatus.stalledStageLabel,
        hasPendingCustomerMessage,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              direction: lastMessage.direction,
              body: lastMessage.body,
              createdAt: lastMessage.createdAt.toISOString(),
            }
          : null,
      };
    });

    const items = allItems;

    return {
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
      summary,
    };
  }

  private async getSummaryRows(user?: LeadAccessUser, agentScope?: string) {
    const rows = await this.chatbotRepository.listConversationSummaries(user, agentScope);
    return rows.map((row) => ({
      id: row.id, state: row.state, memory: this.parseMemory(row.memory),
      ownerUserId: row.ownerUserId, updatedAt: row.updatedAt.toISOString(),
      messages: row.messages.map((message) => ({ direction: message.direction, createdAt: message.createdAt.toISOString() })),
    }));
  }

  async getSummary(user: LeadAccessUser, agentScope?: string) {
    return buildConversationSummary(await this.getSummaryRows(user, agentScope));
  }

  async getDetail(
    conversationId: string,
    user?: LeadAccessUser,
    params?: { offset?: number; limit?: number },
  ) {
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 40;
    const conversation = await this.chatbotRepository.getConversationById(conversationId, user, {
      skip: offset,
      take: limit,
    });
    if (!conversation) return null;

    const memory = this.parseMemory(conversation.memory);
    const chronologicalMessages = [...conversation.messages]
      .reverse()
      .map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        attachment: attachmentForMessage(message.id, message.rawPayload),
        createdAt: message.createdAt.toISOString(),
      }));

    return {
      id: conversation.id,
      phone: conversation.phone,
      contactName: typeof memory.contactName === "string" ? memory.contactName : null,
      state: conversation.state,
      updatedAt: conversation.updatedAt.toISOString(),
      lead: conversation.lead
        ? {
            id: conversation.lead.id,
            name: conversation.lead.name,
            email: conversation.lead.email,
            cep: conversation.lead.cep,
            city: conversation.lead.city,
            state: conversation.lead.state,
          }
        : null,
      agent: conversation.agent ? { id: conversation.agent.id, name: conversation.agent.name } : null,
      owner: conversation.owner ? { id: conversation.owner.id, name: conversation.owner.name, role: conversation.owner.role } : null,
      ownerUserId: conversation.ownerUserId,
      tags: memory.tags ?? [],
      memory,
      botActive: !conversation.ownerUserId && memory.humanTakeover !== true && memory.blocked !== true && !["MANUAL", "BLOCKED", "HUMAN_HANDOFF", "FINISHED"].includes(conversation.state),
      messages: chronologicalMessages,
      messagesPagination: {
        total: conversation._count.messages,
        offset,
        limit,
        hasMore: offset + chronologicalMessages.length < conversation._count.messages,
      },
    };
  }

  async listAssignableUsers() {
    return this.chatbotRepository.listAssignableUsers();
  }

  async assignOwner(id: string, ownerId: string | null, user: LeadAccessUser) {
    const detail = await this.getDetail(id,user);
    if (!detail) throw new Error("Conversa não encontrada.");
    if (ownerId && !(await this.listAssignableUsers()).some(owner=>owner.id===ownerId)) throw new Error("Responsável inválido.");
    if (user.role !== "ADMIN" && ownerId && ownerId !== user.id) throw new Error("FORBIDDEN");
    if (!ownerId && (detail.memory.pendingBotReply as {sending?:boolean}|undefined)?.sending) throw new Error("Entrega incerta. Confira o histórico antes de liberar a automação.");
    await this.chatbotRepository.setOwner(id,ownerId);
    return this.getDetail(id,user.role === "ADMIN" ? user : undefined);
  }
  async toggleBotControl(id: string, ownerId: string | null, user: LeadAccessUser) {
    const detail=await this.getDetail(id,user);
    if (!detail) throw new Error("Conversa não encontrada.");
    if (["FINISHED","BLOCKED"].includes(detail.state) || detail.memory.blocked) throw new Error("Atendimento encerrado ou bloqueado; a automação permanece suspensa.");
    return this.assignOwner(id,detail.botActive ? ownerId : null,user);
  }
  async updateTags(id: string, tags: ConversationTag[], user: LeadAccessUser) {
    if (!await this.getDetail(id,user)) throw new Error("Conversa não encontrada.");
    await this.chatbotRepository.updateTags(id,normalizeTags(tags));
    return this.getDetail(id,user);
  }
  async deleteConversation(id: string, user: LeadAccessUser) {
    if (!await this.getDetail(id,user)) throw new Error("Conversa não encontrada.");
    await this.chatbotRepository.deleteConversation(id);
    return {success:true};
  }
  private parseMemory(memory: unknown): ConversationMemory {
    if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
      return {};
    }

    const record = memory as Record<string, unknown>;
    const tags = Array.isArray(record.tags)
      ? record.tags
          .map((tag) => normalizeTag(tag))
          .filter((tag): tag is ConversationTag => Boolean(tag))
      : [];
    return {
      ...record,
      tags,
    };
  }
}

type ConversationSummaryRow = {
  state: string;
  memory: ConversationMemory;
  ownerUserId: string | null;
  updatedAt: string;
  messages: Array<{ direction: string; createdAt: string }>;
};

function buildConversationSummary(rows: ConversationSummaryRow[]) {
  let unavailable = 0;
  let finished = 0;
  let stalled = 0;

  for (const row of rows) {
    const liveStatus = getConversationFlowStatus(row);
    if (row.state === "FINISHED_UNAVAILABLE") unavailable += 1;
    if (row.state === "FINISHED") finished += 1;
    if (liveStatus.isStalled) stalled += 1;
  }

  return {
    unavailable,
    finished,
    stalled,
  };
}

function matchesConversationFilter(
  conversation: { state: string; memory?: ConversationMemory | null; isStalled?: boolean },
  filter: "all" | "unavailable" | "finished" | "stalled",
) {
  if (filter === "unavailable") return conversation.state === "FINISHED_UNAVAILABLE";
  if (filter === "finished") return conversation.state === "FINISHED";
  if (filter === "stalled") return Boolean(conversation.isStalled);
  return true;
}

function getConversationFlowStatus(input: {
  state: string;
  memory: ConversationMemory;
  ownerUserId: string | null;
  updatedAt: string;
  messages: Array<{ direction: string; createdAt: string }>;
}) {
  if (
    input.ownerUserId || input.memory.humanTakeover || input.memory.blocked ||
    ["START", "MANUAL", "BLOCKED", "FINISHED", "FINISHED_UNAVAILABLE", "HUMAN_HANDOFF"].includes(input.state)
  ) {
    return { isStalled: false, stalledStageLabel: null as string | null };
  }

  const latestInbound = input.messages.find((message) => message.direction === "inbound");
  const latestOutbound = input.messages.find((message) => message.direction === "outbound");
  const outboundAt = latestOutbound ? new Date(latestOutbound.createdAt) : null;
  const inboundAt = latestInbound ? new Date(latestInbound.createdAt) : null;
  const crisWasLastToReply = Boolean(
    outboundAt &&
    (!inboundAt || outboundAt.getTime() >= inboundAt.getTime()),
  );

  if (!crisWasLastToReply) {
    return { isStalled: false, stalledStageLabel: null as string | null };
  }

  return {
    isStalled: true,
    stalledStageLabel: promptLabelForState(input.memory.awaitingFlowState ?? input.state),
  };
}

function promptLabelForState(state: string) {
  const prompts: Record<string, string> = {
    ASK_CEP: "o CEP da instalação",
    ASK_NAME: "o seu nome completo",
    ASK_DOCUMENT: "o seu CPF ou CNPJ",
    ASK_BIRTH_DATE: "a sua data de nascimento",
    ASK_STREET_NUMBER: "o número da sua residência",
    ASK_COMPLEMENT: "o complemento do endereço",
    ASK_BILLING_DUE_DAY: "a data de vencimento escolhida",
    ASK_EMAIL: "o seu e-mail",
    RECOMMEND_PLAN: "se quer seguir com o plano recomendado ou ver outras opções",
    CHOOSE_PLAN: "qual plano você deseja escolher",
    CONFIRM_DATA: "a confirmação dos dados",
    CORRECTION: "a correção dos dados",
  };

  return prompts[state] ?? "a informação pendente do seu cadastro";
}

function normalizeTags(tags: ConversationTag[]) {
  const unique = new Map<string, ConversationTag>();

  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized) continue;
    unique.set(normalized.label.toLowerCase(), normalized);
  }

  return Array.from(unique.values()).slice(0, 20);
}

function normalizeTag(tag: unknown): ConversationTag | null {
  if (typeof tag === "string") {
    const label = tag.trim();
    return label ? { label, color: DEFAULT_TAG_COLOR } : null;
  }

  if (!tag || typeof tag !== "object" || Array.isArray(tag)) {
    return null;
  }

  const record = tag as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const color = typeof record.color === "string" && record.color.trim() ? record.color.trim() : DEFAULT_TAG_COLOR;

  if (!label) return null;

  return {
    label,
    color,
  };
}

