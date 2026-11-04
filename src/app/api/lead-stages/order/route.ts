import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { logAudit } from "@/lib/audit";
import { reorderLeadStages, StageOrderConflict } from "@/modules/leads/services/stage-order.service";

export async function PUT(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.leadsEdit);
    const stages = await reorderLeadStages(await request.json());
    await logAudit({ userId: user.id, action: "UPDATE", module: "leads", description: "Ordem das categorias do Kanban atualizada.", metadata: { stageIds: stages.map(stage => stage.id) } });
    return NextResponse.json(successResponse("Ordem das categorias salva.", stages));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    if (error instanceof ZodError) return NextResponse.json(errorResponse("Ordem de categorias inválida.", "VALIDATION_ERROR"), { status: 422 });
    if (error instanceof StageOrderConflict || (error && typeof error === "object" && "code" in error && error.code === "P2034")) {
      return NextResponse.json(errorResponse("As categorias mudaram. Atualize o quadro e organize novamente.", "STAGE_ORDER_CONFLICT"), { status: 409 });
    }
    return NextResponse.json(errorResponse("Não foi possível salvar a ordem das categorias."), { status: 500 });
  }
}
