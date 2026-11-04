import { resolveSelectedAgent } from "@/services/whatsapp-agent";
import { withEvolutionInstance } from "@/services/evolution-context";
import { NextResponse } from "next/server";
import { permissions } from "@/constants/permissions";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { cancelBroadcastDispatches, deleteBroadcastDispatches, listBroadcastDispatches } from "@/services/whatsapp-broadcast";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.conversationsView);
    const agent = await resolveSelectedAgent(new URL(request.url).searchParams.get("agentId") || undefined);
    return await withEvolutionInstance(agent.zapiInstanceId!, async () => {
    const records = await listBroadcastDispatches();
    return NextResponse.json(successResponse("Historico de disparos consultado.", records));
    });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse("Nao foi possivel consultar os disparos."), { status: 500 });
  }
}

export async function POST(_request: Request) {
  return NextResponse.json(errorResponse("O disparo antigo foi substituído. Use WhatsApp Oficial em /envio-em-massa.", "OFFICIAL_META_REQUIRED"), { status: 410 });
}

export async function PUT(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.conversationsView);
    const body = await request.json().catch(() => ({})) as { ids?: string[]; action?: string; agentId?: string };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string" && id.trim()) : [];
    if (body.action !== "cancel" || !ids.length) {
      return NextResponse.json(errorResponse("Informe os agendamentos para cancelar.", "VALIDATION_ERROR"), { status: 422 });
    }
    const agent = await resolveSelectedAgent(body.agentId || new URL(request.url).searchParams.get("agentId") || undefined);
    const result = await withEvolutionInstance(agent.zapiInstanceId!, () => cancelBroadcastDispatches(ids));
    return NextResponse.json(successResponse("Agendamento cancelado.", result));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse("Nao foi possivel cancelar o agendamento."), { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.conversationsView);
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({})) as { ids?: string[]; all?: boolean; agentId?: string };
    const deleteAll = body.all === true || url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";
    const ids = Array.isArray(body.ids) ? body.ids : url.searchParams.getAll("id");
    const agent = await resolveSelectedAgent(body.agentId || url.searchParams.get("agentId") || undefined);
    const result = await withEvolutionInstance(agent.zapiInstanceId!, () => deleteBroadcastDispatches(deleteAll ? undefined : ids));
    return NextResponse.json(successResponse("Historico de disparos excluido.", result));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse("Nao foi possivel excluir o historico."), { status: 500 });
  }
}
