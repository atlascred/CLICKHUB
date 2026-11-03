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
    const tags = Array.isArray(body.tags)
      ? body.tags.map((tag: unknown) =>
          typeof tag === "string"
            ? { label: tag, color: "sky" }
            : {
                label: String((tag as { label?: unknown })?.label ?? ""),
                color: String((tag as { color?: unknown })?.color ?? "sky"),
              },
        )
      : [];
    const detail = await conversationService.updateTags(String(body.conversationId ?? ""), tags, user);

    return NextResponse.json(successResponse("Etiquetas atualizadas.", detail));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse(error instanceof Error ? error.message : "Nao foi possivel atualizar as etiquetas."), {
      status: 500,
    });
  }
}
