import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { conversationAgentWhere, type LeadAccessUser } from "@/lib/lead-source-access";

/** Inbox-only adapter. The chatbot repository and flow are not changed. */
export class InboxRepository {
  constructor(private readonly db = prisma) {}
  async countConversations(user?: LeadAccessUser, agentScope?: string) {
    return this.db.chatConversation.count({
      where: buildConversationAccessWhere(user, agentScope),
    });
  }

  async listConversations(params?: { skip?: number; take?: number; ids?: string[]; user?: LeadAccessUser; agentScope?: string }) {
    return this.db.chatConversation.findMany({
      where: { ...buildConversationAccessWhere(params?.user, params?.agentScope), ...(params?.ids ? { id: { in: params.ids } } : {}) },
      select: {
        id: true,
        phone: true,
        state: true,
        updatedAt: true,
        ownerUserId: true,
        memory: true,
        lead: {
          select: {
            id: true,
            name: true,
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
            zapiInstanceId: true,
          },
        },
        owner: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        messages: {
          select: {
            id: true,
            direction: true,
            body: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 2,
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: params?.skip ?? 0,
      take: params?.take ?? 25,
    });
  }

  async getConversationById(
    id: string,
    user?: LeadAccessUser,
    messages?: { skip?: number; take?: number },
  ) {
    return this.db.chatConversation.findFirst({
      where: { id, ...buildConversationAccessWhere(user) },
      select: {
        id: true,
        phone: true,
        state: true,
        updatedAt: true,
        ownerUserId: true,
        memory: true,
        lead: true,
        agent: { select: { id: true, name: true, zapiInstanceId: true } },
        owner: { select: { id: true, name: true, role: true } },
        _count: {
          select: {
            messages: true,
          },
        },
        messages: {
          select: {
            id: true,
            direction: true,
            body: true,
            rawPayload: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          skip: messages?.skip ?? 0,
          take: messages?.take ?? 40,
        },
      },
    });
  }

  async getDeliveryTarget(id: string, user: LeadAccessUser) {
    return this.db.chatConversation.findFirst({
      where: { id, ...buildConversationAccessWhere(user) },
      select: { id: true, phone: true, agentId: true },
    });
  }

  async listAssignableUsers() {
    return this.db.user.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
      },
    });
  }


  async listConversationSummaries(user?: LeadAccessUser, agentScope?: string) {
    return this.db.chatConversation.findMany({
      where: buildConversationAccessWhere(user, agentScope),
      select: { id: true, state: true, memory: true, ownerUserId: true, updatedAt: true,
        messages: { select: { direction: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 } },
    });
  }
  async updateTags(id: string, tags: Prisma.InputJsonValue) {
    await this.db.$executeRaw`UPDATE "ChatConversation" SET "memory" = jsonb_set(COALESCE("memory", '{}'::jsonb), '{tags}', ${JSON.stringify(tags)}::jsonb), "updatedAt" = NOW() WHERE id = ${id}::uuid AND "deletedAt" IS NULL`;
  }
  async setOwner(id: string, ownerId: string | null) {
    // Merge against current JSON inside PostgreSQL, never overwrite a newer bot turn.
    // Finished/blocked states remain protected, even when the operator changes owner.
    await this.db.$executeRaw`UPDATE "ChatConversation" SET
      "ownerUserId" = ${ownerId}::uuid,
      "memory" = COALESCE("memory", '{}'::jsonb) || jsonb_build_object(
        'humanTakeover', ${Boolean(ownerId)},
        'inboxResumeState', CASE WHEN "state" NOT IN ('MANUAL','HUMAN_HANDOFF','BLOCKED','FINISHED') THEN "state" ELSE COALESCE("memory"->>'inboxResumeState', 'START') END),
      "state" = CASE
        WHEN "state" IN ('FINISHED','BLOCKED') OR COALESCE(("memory"->>'blocked')::boolean,false) THEN "state"
        WHEN ${Boolean(ownerId)} THEN 'MANUAL'
        WHEN "state" IN ('MANUAL','HUMAN_HANDOFF') THEN COALESCE("memory"->>'inboxResumeState', 'START')
        ELSE "state" END,
      "updatedAt" = NOW()
      WHERE id = ${id}::uuid AND "deletedAt" IS NULL`;
  }
  async deleteConversation(id: string) {
    return this.db.chatConversation.update({where:{id},data:{deletedAt:new Date()}});
  }
}

export function buildConversationAccessWhere(user?: LeadAccessUser, agentScope?: string): Prisma.ChatConversationWhereInput {
  return { deletedAt: null, NOT: { state: { startsWith: "DISPATCH_" } }, ...conversationAgentWhere(user, agentScope),
    ...(user?.role === "EMPLOYEE" ? { ownerUserId: user.id } : {}) };
}
