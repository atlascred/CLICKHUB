import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { requireCurrentUser } from "@/lib/auth-context";
import { InboxService } from "@/modules/conversas/services/inbox.service";

const conversationService = new InboxService();

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.conversationsView);
    const body = await request.json();
    const detail = await conversationService.toggleBotControl(
      String(body.conversationId ?? ""),
      user.id,
      user,
    );

    return NextResponse.json(successResponse("Controle da conversa atualizado.", detail));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse(error instanceof Error ? error.message : "Nao foi possivel atualizar a conversa."), {
      status: 500,
    });
  }
}
