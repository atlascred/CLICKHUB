import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { requireCurrentUser } from "@/lib/auth-context";
import { InboxService } from "@/modules/conversas/services/inbox.service";

const conversationService = new InboxService();

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.conversationsView);
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId");
    const agentScope = searchParams.get("agent");
    if (searchParams.get("summaryOnly") === "1") {
      return NextResponse.json(successResponse("Contagens consultadas.", await conversationService.getSummary(user, agentScope ?? undefined)));
    }
    const offset = Number(searchParams.get("offset") ?? "0");
    const limit = Number(searchParams.get("limit") ?? "25");
    const filter = searchParams.get("filter");
    const messagesOffset = Number(searchParams.get("messagesOffset") ?? "0");
    const messagesLimit = Number(searchParams.get("messagesLimit") ?? "40");

    if (conversationId) {
      const conversation = await conversationService.getDetail(conversationId, user, {
        offset: Number.isFinite(messagesOffset) && messagesOffset > 0 ? messagesOffset : 0,
        limit: Number.isFinite(messagesLimit) && messagesLimit > 0 ? Math.min(messagesLimit, 100) : 40,
      });
      return NextResponse.json(successResponse("Conversa consultada.", conversation));
    }

    const [conversations, users] = await Promise.all([
      conversationService.list({
        offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25,
        user,
        agentScope: agentScope ?? undefined,
        includeSummary: searchParams.get("includeSummary") !== "0",
        filter: filter === "unavailable" || filter === "finished" || filter === "stalled" ? filter : "all",
      }),
      // Assignment options are supplementary; do not discard the inbox if they fail.
      conversationService.listAssignableUsers().catch(() => []),
    ]);

    return NextResponse.json(successResponse("Conversas consultadas.", { conversations, users }));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse("Nao foi possivel consultar as conversas."), {
      status: 500,
    });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.conversationsView);
    const body = await request.json();
    const content = String(body.content ?? "").trim();
    if (!content) return NextResponse.json(errorResponse("Informe a mensagem."), { status: 422 });
    const { deliverInboxMessage } = await import("@/modules/conversas/services/inbox-delivery");
    const detail = await deliverInboxMessage(request, user, String(body.conversationId ?? ""), { message: content });
    return NextResponse.json(successResponse("Mensagem enviada.", detail));
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json(errorResponse(error instanceof Error ? error.message : "Falha no envio."), { status: 500 });
  }
}
