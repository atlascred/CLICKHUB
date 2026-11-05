import { prisma } from "@/lib/prisma";
import { FOLLOW_UP_SETTINGS_KEY, followUpPrompts, jsonObject, type FollowUpSettings } from "@/modules/chatbot/follow-up";
import { saveEvolutionOutbound } from "@/repositories/evolution-outbound.repository";
import type { Prisma } from "@prisma/client";

export class FollowUpRepository {
  constructor(private readonly db = prisma) {}
  async settings(): Promise<FollowUpSettings> {
    const value = jsonObject((await this.db.appSetting.findUnique({ where: { key: FOLLOW_UP_SETTINGS_KEY } }))?.value);
    return { enabled: value.enabled === true, instances: Array.isArray(value.instances) ? value.instances.filter((v): v is string => typeof v === "string") : [], activatedAt: String(value.activatedAt ?? "") };
  }
  async candidates(settings: FollowUpSettings, now: Date, skip: number) {
    return this.db.chatConversation.findMany({
      where: { deletedAt: null, ownerUserId: null, state: { in: Object.keys(followUpPrompts) },
        agent: { active: true, deletedAt: null, zapiInstanceId: { in: settings.instances } },
        messages: { some: { direction: "outbound", createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } } },
      include: { lead: { select: { status: true, deletedAt: true } }, agent: { select: { id: true, active: true, deletedAt: true, zapiInstanceId: true } }, messages: { orderBy: { createdAt: "desc" }, take: 10 } },
      orderBy: { id: "asc" }, skip, take: 100,
    });
  }
  async get(id: string) {
    return this.db.chatConversation.findUnique({ where: { id }, include: {
      lead: { select: { status: true, deletedAt: true } }, agent: { select: { id: true, active: true, deletedAt: true, zapiInstanceId: true } }, messages: { orderBy: { createdAt: "desc" }, take: 10 },
    } });
  }
  async claim(key: string, conversationId: string, state: string, now: Date) {
    try { await this.db.appSetting.create({ data: { key, value: { status: "claimed", conversationId, state, claimedAt: now.toISOString() } } }); return true; }
    catch (error) { if ((error as { code?: string }).code === "P2002") return false; throw error; }
  }
  async mark(key: string, status: string, extra: Record<string, unknown> = {}) {
    await this.db.$executeRaw`UPDATE "AppSetting" SET "value" = "value" || ${JSON.stringify({ status, ...extra })}::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = ${key}`;
  }
  async save(input: { conversationId: string; instanceName: string; messageId: string; body: string; sentAt: Date; anchorId: string; stage: number }) {
    return saveEvolutionOutbound(this.db, { ...input, rawPayload: { provider: "evolution", instanceName: input.instanceName,
      kind: "texto", followUp: true, followUpAnchor: input.anchorId, followUpStage: input.stage } as Prisma.InputJsonValue });
  }
}
