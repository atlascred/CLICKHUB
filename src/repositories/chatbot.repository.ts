import { buildConversationAccessWhere } from "@/repositories/inbox.repository";
import type { LeadAccessUser } from "@/lib/lead-source-access";
import { saveEvolutionOutbound } from "@/repositories/evolution-outbound.repository";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class ChatbotRepository {
  constructor(private readonly db = prisma) {}
  async findReplyReceipt(providerId: string) {
    return this.db.chatMessage.findFirst({
      where: { direction: "outbound", OR: [
        { providerId: `reply-to:${providerId}` },
        { rawPayload: { path: ["inReplyTo"], array_contains: [providerId] } },
      ] },
      select: { id: true, conversationId: true, createdAt: true },
    });
  }
  async findMessageByProviderId(providerId: string) {
    return this.db.chatMessage.findFirst({
      where: { providerId },
      select: { id: true, conversationId: true, createdAt: true },
    });
  }

  async hasOutboundResponseAfter(conversationId: string, receivedAt: Date) {
    const response = await this.db.chatMessage.findFirst({
      where: {
        conversationId,
        direction: "outbound",
        createdAt: { gte: receivedAt },
      },
      select: { id: true },
    });

    return Boolean(response);
  }

  async findOrCreateConversation(phone: string, agentId?: string) {
    const [protectedConversation, existing] = await Promise.all([
      this.db.chatConversation.findFirst({
      where: { phone, agentId: agentId ?? null, NOT: { state: { startsWith: "DISPATCH_" } }, deletedAt: null, OR: [
        { state: { in: ["BLOCKED", "HUMAN_HANDOFF", "MANUAL"] } },
        { memory: { path: ["humanTakeover"], equals: true } },
        { memory: { path: ["blocked"], equals: true } },
      ] },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 10 } },
      orderBy: { updatedAt: "desc" },
    }),
      this.db.chatConversation.findFirst({
      where: { phone, agentId: agentId ?? null, NOT: { state: { startsWith: "DISPATCH_" } }, deletedAt: null },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 10 } },
    }),
    ]);
    if (protectedConversation) return protectedConversation;

    if (existing) {
      return existing;
    }

    return this.db.chatConversation.create({
      data: { phone, agentId, state: "START", memory: {} },
      include: { messages: true },
    });
  }

  async saveMessage(input: {
    conversationId: string;
    direction: "inbound" | "outbound";
    body: string;
    providerId?: string;
    rawPayload?: Prisma.InputJsonValue;
  }) {
    const raw: Record<string, unknown> = input.rawPayload && typeof input.rawPayload === "object" && !Array.isArray(input.rawPayload) ? input.rawPayload as Record<string, unknown> : {};
    if (input.direction === "outbound" && raw.provider === "evolution" && typeof raw.instanceName === "string" && typeof raw.providerMessageId === "string") {
      return saveEvolutionOutbound(this.db, { conversationId: input.conversationId, instanceName: raw.instanceName,
        messageId: raw.providerMessageId, body: input.body, rawPayload: input.rawPayload! });
    }
    const message = await this.db.chatMessage.create({
      data: input,
    });
    await this.db.chatConversation.update({
      where: { id: input.conversationId },
      data: { updatedAt: new Date() },
    });
    return message;
  }

  async findConversationById(id: string, user?: LeadAccessUser) {
    return this.db.chatConversation.findFirst({
      where: { id, ...buildConversationAccessWhere(user) },
      include: {
        lead: true,
        agent: { select: { id: true, name: true, zapiInstanceId: true } },
        owner: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async findConversationByPhone(phone: string, agentId?: string) {
    return this.db.chatConversation.findFirst({
      where: { phone, agentId: agentId ?? null, NOT: { state: { startsWith: "DISPATCH_" } }, deletedAt: null },
      include: { messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });
  }

  async createManualConversation(input: {
    phone: string;
    name?: string;
    assignedTo?: string;
    tags?: unknown;
    ownerUserId?: string;
    agentId?: string;
  }) {
    const tags = normalizeTags(input.tags);
    return this.db.chatConversation.create({
      data: {
        phone: input.phone,
        agentId: input.agentId,
        state: "MANUAL",
        ownerUserId: input.ownerUserId,
        memory: {
          contactName: input.name?.trim() || input.phone,
          assignedTo: input.assignedTo?.trim() || "Equipe",
          tags,
        },
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  async updateManualConversation(input: {
    id: string;
    name?: string;
    assignedTo?: string;
    tags?: unknown;
    state?: string;
    blocked?: boolean;
    humanTakeover?: boolean;
  }) {
    const current = await this.db.chatConversation.findUnique({ where: { id: input.id } });
    if (!current) {
      throw new Error("Conversation not found");
    }

    if (input.blocked !== undefined) {
      const conversations = await this.db.chatConversation.findMany({
        where: { phone: current.phone, agentId: current.agentId, deletedAt: null },
        select: { id: true, state: true, memory: true },
      });

      await this.db.$transaction(conversations.map((conversation) => {
        const conversationMemory = normalizeJsonObject(conversation.memory);
        const conversationPreviousState = typeof conversationMemory.previousState === "string"
          ? conversationMemory.previousState
          : undefined;
        const nextState = input.blocked
          ? "BLOCKED"
          : conversationPreviousState ?? "MANUAL";

        return this.db.chatConversation.update({
          where: { id: conversation.id },
          data: {
            state: nextState,
            memory: normalizeJsonValue({
              ...conversationMemory,
              contactName: conversation.id === input.id ? input.name ?? conversationMemory.contactName : conversationMemory.contactName,
              assignedTo: conversation.id === input.id ? input.assignedTo ?? conversationMemory.assignedTo : conversationMemory.assignedTo,
              tags: conversation.id === input.id ? input.tags ?? conversationMemory.tags : conversationMemory.tags,
              blocked: input.blocked,
              previousState: input.blocked ? (conversationPreviousState ?? conversation.state ?? "MANUAL") : conversationPreviousState,
            }),
          },
        });
      }));

      const updated = await this.db.chatConversation.findUnique({
        where: { id: input.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!updated) {
        throw new Error("Conversation not found");
      }
      return updated;
    }

    const memory = normalizeJsonObject(current?.memory);
    const previousState = typeof memory.previousState === "string" ? memory.previousState : undefined;
    const nextState = input.blocked === true
      ? "BLOCKED"
      : input.blocked === false
        ? previousState ?? "MANUAL"
        : input.state ?? (input.humanTakeover === false && current?.state === "MANUAL" ? previousState ?? "START" : current?.state);
    return this.db.chatConversation.update({
      where: { id: input.id },
      data: {
        state: nextState,
        memory: normalizeJsonValue({
          ...memory,
          contactName: input.name ?? memory.contactName,
          assignedTo: input.assignedTo ?? memory.assignedTo,
          tags: input.tags ?? memory.tags,
          blocked: input.blocked ?? memory.blocked,
          humanTakeover: input.humanTakeover ?? memory.humanTakeover,
          pendingBotReply: input.humanTakeover === false ? null : memory.pendingBotReply,
          takeoverAt: input.humanTakeover === true ? new Date().toISOString() : input.humanTakeover === false ? null : memory.takeoverAt,
          takeoverReason: input.humanTakeover === true ? (memory.takeoverReason ?? "Assumido manualmente no CRM.") : input.humanTakeover === false ? null : memory.takeoverReason,
          previousState: input.blocked === true ? (previousState ?? current?.state ?? "MANUAL") : previousState,
        }),
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  async softDeleteConversation(id: string) {
    return this.db.chatConversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async claimInboundMessage(input: {
    conversationId: string;
    body: string;
    providerId: string;
    rawPayload?: Prisma.InputJsonValue;
  }) {
    try {
      await this.db.chatMessage.create({
        data: {
          conversationId: input.conversationId,
          body: input.body,
          providerId: input.providerId,
          rawPayload: input.rawPayload,
          direction: "inbound",
        },
      });
      await this.db.chatConversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  async updateConversation(input: {
    id: string;
    state: string;
    memory: Prisma.InputJsonValue;
    leadId?: string;
  }, readBack = true) {
    const count = await this.db.$executeRaw`
      UPDATE "ChatConversation"
      SET "state" = ${input.state}, "memory" = ${JSON.stringify(input.memory)}::jsonb,
          "leadId" = COALESCE(${input.leadId ?? null}::uuid, "leadId"), "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.id}::uuid
        AND COALESCE("memory"->>'humanTakeover', 'false') <> 'true'
        AND COALESCE("memory"->>'blocked', 'false') <> 'true'
        AND "state" NOT IN ('BLOCKED', 'HUMAN_HANDOFF', 'MANUAL', 'FINISHED')
    `;
    if (!count) throw new Error("Conversa assumida ou bloqueada durante o processamento.");
    return readBack ? this.db.chatConversation.findUnique({ where: { id: input.id } }) : null;
  }

  async getConversationControl(id: string) {
    return this.db.chatConversation.findUnique({ where: { id }, select: { state: true, memory: true } });
  }

  async finalizePendingReply(providerId: string) {
    const inbound = await this.findMessageByProviderId(providerId);
    if (!inbound) return;
    const conversation = await this.db.chatConversation.findUnique({ where: { id: inbound.conversationId } });
    const memory = normalizeJsonObject(conversation?.memory);
    if (memory.humanTakeover === true || memory.blocked === true) return;
    const pending = memory.pendingBotReply as { providerId?: string; batchIds?: string[]; next?: { state: string; memory: Prisma.InputJsonValue; leadId?: string } } | undefined;
    if ((pending?.providerId === providerId || pending?.batchIds?.includes(providerId)) && pending?.next) {
      await this.updateConversation({ id: inbound.conversationId, ...pending.next });
    }
  }

  async createLeadFromChat(input: {
    name: string;
    motherName?: string;
    phone: string;
    email?: string;
    cpfCnpj?: string;
    birthDate?: Date;
    cep?: string;
    address?: string;
    streetNumber?: string;
    complement?: string;
    city?: string;
    state?: string;
    neighborhood?: string;
    billingDueDay?: number;
    planId?: string;
    planName?: string;
    expectedValue?: number;
    notes?: string;
    requestId?: string;
  }) {


    const data = {
      name: input.name,
      motherName: input.motherName,
      phone: input.phone,
      email: input.email,
      cpfCnpj: input.cpfCnpj,
      birthDate: input.birthDate,
      cep: input.cep,
      address: input.address,
      streetNumber: input.streetNumber,
      complement: input.complement,
      city: input.city,
      state: input.state,
      neighborhood: input.neighborhood,
      billingDueDay: input.billingDueDay,
      planId: input.planId,
      planName: input.planName,
      planValue: input.expectedValue,
      expectedValue: input.expectedValue,
      source: "chatbot",
      notes: input.notes,
    };

    if (input.requestId) {
      // A confirmation event creates at most one lead and never overwrites an old sale.
      const { createHash } = await import("node:crypto");
      const key = `chatbot:lead:${createHash("sha256").update(input.requestId).digest("hex")}`;
      return this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
        const receipt = await tx.appSetting.findUnique({ where: { key } });
        const leadId = (receipt?.value as { leadId?: string } | null)?.leadId;
        if (leadId) {
          const lead = await tx.lead.findUnique({ where: { id: leadId } });
          if (lead) return lead;
        }
        const lead = await tx.lead.create({ data });
        await tx.appSetting.upsert({ where: { key }, create: { key, value: { leadId: lead.id } }, update: { value: { leadId: lead.id } } });
        return lead;
      }, { timeout: 15000 });
    }

    const existing = await this.db.lead.findFirst({
      where: { phone: input.phone, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return this.db.lead.update({
        where: { id: existing.id },
        data: {
          ...data,
          status: existing.status === "LOST" ? "NEW" : existing.status,
        },
      });
    }

    return this.db.lead.create({
      data: {
        ...data,
        cep: input.cep,
      },
    });
  }

  async getDefaultAgent() {
    return this.db.agent.findFirst({
      where: { active: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async getAgentByInstance(instanceId?: string, strict = false) {
    if (strict) {
      if (!instanceId) throw new Error("Instância obrigatória para o agente Evolution.");
      const agents = await this.db.agent.findMany({
        where: { zapiInstanceId: instanceId, active: true, deletedAt: null },
        include: { plans: { where: { active: true, deletedAt: null }, orderBy: [{ order: "asc" }, { price: "asc" }] } },
        take: 2,
      });
      if (agents.length !== 1) throw new Error("A instância deve possuir exatamente um agente ativo.");
      return agents[0];
    }
    if (instanceId) {
      const agent = await this.db.agent.findFirst({
        where: { zapiInstanceId: instanceId, active: true, deletedAt: null },
        include: { plans: { where: { active: true, deletedAt: null }, orderBy: [{ order: "asc" }, { price: "asc" }] } },
      });
      if (agent) return agent;
    }
    return this.db.agent.findFirst({
      where: { active: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: { plans: { where: { active: true, deletedAt: null }, orderBy: [{ order: "asc" }, { price: "asc" }] } },
    });
  }

  async listActivePlans(agentId?: string) {
    return this.db.plan.findMany({
      where: { active: true, deletedAt: null, agents: agentId ? { some: { id: agentId } } : undefined },
      orderBy: [{ order: "asc" }, { price: "asc" }],
    });
  }

  async listConversations(agentId?: string, user?: LeadAccessUser) {
    return this.db.chatConversation.findMany({
      where: { ...buildConversationAccessWhere(user), ...(agentId ? { agentId } : {}) },
      include: {
        lead: true,
        agent: { select: { id: true, name: true, zapiInstanceId: true } },
        owner: { select: { id: true, name: true, role: true } },
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  }
}

function normalizeJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeTags(value: unknown) {
  const tags = Array.isArray(value)
    ? value.map((tag) => String(tag))
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function normalizeJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
