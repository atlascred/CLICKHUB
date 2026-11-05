import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { LeadConversationService } from "@/modules/leads/services/lead-conversation.service";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.leadsView);
    assertPermission(user, permissions.conversationsView);
    const { id } = await context.params;
    const result = await new LeadConversationService().resolve(id, user);
    if (result.status === "not_found") return NextResponse.json(errorResponse("Lead não encontrado.", "NOT_FOUND"), { status: 404 });
    if (result.status === "forbidden") return NextResponse.json(errorResponse("Você não tem acesso à conversa deste lead.", "FORBIDDEN"), { status: 403 });
    return NextResponse.json(successResponse("Conversa do lead localizada.", result), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return authErrorResponse(error) ?? NextResponse.json(errorResponse("Não foi possível localizar a conversa do lead."), { status: 500 }); }
}
