import type { Prisma, PrismaClient } from "@prisma/client";
import { scopedEvolutionId } from "@/services/evolution-context";

type OutboundInput = {
  instanceName: string;
  messageId: string;
  body: string;
  rawPayload: Prisma.InputJsonValue;
  sentAt?: Date;
} & ({ conversationId: string } | { phone: string; agentId: string });

/** Phone events, CRM sends and bot receipts converge on the same provider ID. */
export async function saveEvolutionOutbound(db: PrismaClient, input: OutboundInput) {
  return db.$transaction(async (tx) => {
    const selected = "conversationId" in input ? await tx.chatConversation.findFirst({
      where: { id: input.conversationId, deletedAt: null },
      select: { id: true, phone: true, agentId: true },
    }) : null;
    const phone = selected?.phone ?? ("phone" in input ? input.phone : "");
    const agentId = selected?.agentId ?? ("agentId" in input ? input.agentId : null);
    if (!phone || !agentId) throw new Error("Conversa de saída sem agente ou contato.");
    // Serialize simultaneous phone echoes and API receipts without locking other agents.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`outbound:${input.instanceName}:${agentId}:${phone}`}, 0))::text AS locked`;
    const providerId = scopedEvolutionId(input.instanceName, input.messageId);
    const existing = await tx.chatMessage.findFirst({
      where: { direction: "outbound", providerId: { in: [providerId, input.messageId] }, conversation: { agentId } },
    });
    let conversationId = existing?.conversationId ?? selected?.id;
    if (!conversationId) {
      const conversation = await tx.chatConversation.findFirst({
        where: { phone, agentId, deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true },
      });
      conversationId = conversation?.id;
    }
    if (!conversationId) {
      const conversation = await tx.chatConversation.create({
        data: { phone, agentId, state: "MANUAL", memory: { contactName: phone } }, select: { id: true },
      });
      conversationId = conversation.id;
    }
    const sentAt = input.sentAt ?? new Date();
    const message = existing ?? await tx.chatMessage.create({
      data: { conversationId, providerId, direction: "outbound", body: input.body,
        sentAt, createdAt: sentAt, rawPayload: input.rawPayload },
    });
    if (existing) {
      // Preserve delivery status, attachments and inReplyTo when the other side arrives later.
      await tx.$executeRaw`
        UPDATE "ChatMessage" SET "rawPayload" = COALESCE("rawPayload", '{}'::jsonb) || ${JSON.stringify(input.rawPayload)}::jsonb,
          "sentAt" = COALESCE("sentAt", ${sentAt}::timestamp)
        WHERE "id" = ${existing.id}::uuid
      `;
    } else {
      await tx.chatConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    }
    return message;
  });
}
