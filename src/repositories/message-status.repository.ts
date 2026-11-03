import type { PrismaClient, Prisma } from "@prisma/client";
import { scopedEvolutionId } from "@/services/evolution-context";

/** Merge delivery metadata atomically; never discard media/source/message fields. */
export async function mergeEvolutionStatus(db: Pick<PrismaClient,"$executeRaw">, input: {
  instanceName:string; agentId:string; messageId:string; status:string; raw:Prisma.InputJsonValue;
}) {
  const patch={provider:"evolution",status:input.status,rawLastStatus:input.raw};
  return db.$executeRaw`
    UPDATE "ChatMessage" m SET
      "rawPayload" = COALESCE(m."rawPayload", '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
      "readAt" = COALESCE(${input.status === "lido" ? new Date() : null}::timestamp, m."readAt")
    WHERE m."providerId" IN (${scopedEvolutionId(input.instanceName,input.messageId)}, ${input.messageId})
      AND EXISTS (SELECT 1 FROM "ChatConversation" c WHERE c.id=m."conversationId" AND c."agentId"=${input.agentId}::uuid)
  `;
}
