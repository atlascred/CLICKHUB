import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth-context";
import { authErrorResponse } from "@/lib/api-errors";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.conversationsView);
    const agents = await prisma.agent.findMany({ where: { active: true, deletedAt: null }, orderBy: { createdAt: "asc" },
      select: { id: true, name: true, zapiInstanceId: true, zapiWhatsappNumber: true } });
    return NextResponse.json(successResponse("Agentes disponíveis.", agents.map(a => ({ id: a.id, name: a.name, instanceName: a.zapiInstanceId, number: a.zapiWhatsappNumber }))));
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json(errorResponse("Não foi possível consultar os agentes."), { status: 500 });
  }
}
