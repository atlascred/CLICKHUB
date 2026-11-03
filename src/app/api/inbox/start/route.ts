import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveSelectedAgent } from "@/services/whatsapp-agent";
import { normalizePhone } from "@/services/validators";
import { ConversationService } from "@/modules/chatbot/services/conversation.service";
import { InboxService } from "@/modules/conversas/services/inbox.service";
import { deliverInboxMessage } from "@/modules/conversas/services/inbox-delivery";
import { resolveLeadAgentScope } from "@/lib/lead-source-access";
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(); assertPermission(user, permissions.conversationsView);
    const body = await request.json(); const agent = await resolveSelectedAgent(String(body.agentId ?? "") || undefined);
    const scope = resolveLeadAgentScope(user);
    if (scope !== "both" && agent.zapiInstanceId !== (scope === "click" ? "CLICK" : "GIGA CLICK")) throw new Error("FORBIDDEN");
    const phone = normalizePhone(String(body.phone ?? ""));
    if (!/^55\d{10,11}$/.test(phone)) return NextResponse.json(errorResponse("Informe um WhatsApp válido com DDD."), { status: 422 });
    const ownerUserId = body.ownerUserId ? String(body.ownerUserId) : user.id;
    if (user.role !== "ADMIN" && ownerUserId !== user.id) throw new Error("FORBIDDEN");
    const inbox = new InboxService();
    if (!(await inbox.listAssignableUsers()).some(owner=>owner.id===ownerUserId)) throw new Error("Responsável inválido.");
    const existing = await prisma.chatConversation.findFirst({ where: { phone, agentId: agent.id, deletedAt: null }, orderBy: { updatedAt: "desc" } });
    if (existing && !await inbox.getDetail(existing.id,user)) throw new Error("FORBIDDEN");
    const conversation = existing ?? await new ConversationService().create({ phone, agentId: agent.id, name: String(body.leadName ?? ""), ownerUserId });
    await inbox.assignOwner(conversation.id,ownerUserId,user);
    const detail = String(body.firstMessage ?? "").trim()
      ? await deliverInboxMessage(request,user,conversation.id,{message:String(body.firstMessage).trim()})
      : await inbox.getDetail(conversation.id,user);
    return NextResponse.json(successResponse("Conversa iniciada.",detail));
  } catch (error) { return authErrorResponse(error) ?? NextResponse.json(errorResponse(error instanceof Error ? error.message : "Falha ao iniciar conversa."), { status: 500 }); }
}
