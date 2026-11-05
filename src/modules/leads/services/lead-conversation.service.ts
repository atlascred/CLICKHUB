import { prisma } from "@/lib/prisma";
import { LeadRepository } from "@/repositories/lead.repository";
import { buildConversationAccessWhere } from "@/repositories/inbox.repository";
import { normalizePhone } from "@/services/validators";
import type { LeadAccessUser } from "@/lib/lead-source-access";

export class LeadConversationService {
  constructor(private readonly leads = new LeadRepository(), private readonly db = prisma) {}
  async resolve(id: string, user: LeadAccessUser) {
    const lead = await this.leads.findById(id, user);
    if (!lead) return { status: "not_found" as const };
    const select = { id: true, agentId: true, agent: { select: { zapiInstanceId: true } } } as const;
    const linkedCount = await this.db.chatConversation.count({ where: { leadId: id, deletedAt: null } });
    const conversations = await this.db.chatConversation.findMany({
      where: { ...buildConversationAccessWhere(user), ...(linkedCount ? { leadId: id } : {
        phone: { in: [...new Set([lead.phone, normalizePhone(lead.phone)])] }, leadId: null,
      }) }, select, orderBy: { updatedAt: "desc" },
    });
    if (linkedCount && !conversations.length) return { status: "forbidden" as const };
    // Same contact can have separate NIO/VIVO threads. Never choose another agent silently.
    const seen = new Set<string | null>();
    const options = conversations.filter(c => { if (seen.has(c.agentId)) return false; seen.add(c.agentId); return true; })
      .map(c => ({ id: c.id, agentId: c.agentId, instanceName: c.agent?.zapiInstanceId ?? "" }));
    return { status: "success" as const, lead: { name: lead.name, phone: lead.phone }, conversations: options };
  }
}
