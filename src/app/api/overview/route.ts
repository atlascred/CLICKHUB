import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { OverviewService } from "@/modules/visao-geral/services/overview.service";

const overviewService = new OverviewService();

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.dashboardView);
    const { searchParams } = new URL(request.url);
    const filters = parseOverviewFilters(searchParams);
    const overview = await overviewService.getOverview(filters, user);

    return NextResponse.json(successResponse("Visão geral consultada.", overview));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse("Nao foi possivel consultar a visao geral."), { status: 500 });
  }
}

function parseOverviewFilters(searchParams: URLSearchParams) {
  const preset = searchParams.get("preset") ?? "month";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const now = new Date();

  if (preset === "custom" && from && to) {
    return {
      preset,
      from: startOfDay(new Date(from)),
      to: endOfDay(new Date(to)),
    };
  }

  const fromDate = new Date(now);
  if (preset === "day") fromDate.setDate(now.getDate() - 0);
  else if (preset === "week") fromDate.setDate(now.getDate() - 6);
  else if (preset === "month") fromDate.setDate(now.getDate() - 29);
  else if (preset === "quarter") fromDate.setDate(now.getDate() - 89);
  else if (preset === "semester") fromDate.setDate(now.getDate() - 179);
  else if (preset === "year") fromDate.setDate(now.getDate() - 364);
  else fromDate.setDate(now.getDate() - 29);

  return {
    preset,
    from: startOfDay(fromDate),
    to: endOfDay(now),
  };
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}
