import { NextResponse } from "next/server";
import { utils, write } from "xlsx";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
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

    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.json_to_sheet([
      { Indicador: "Leads criados", Valor: overview.summary.leadsCreated },
      { Indicador: "Leads ganhos", Valor: overview.summary.leadsWon },
      { Indicador: "Receita", Valor: overview.summary.revenue },
      { Indicador: "Conversas finalizadas pela IA/fluxo", Valor: overview.summary.conversationsFinished },
      { Indicador: "Conversas assumidas", Valor: overview.summary.conversationsAssumed },
      { Indicador: "Conversas com Chatbot ativo", Valor: overview.summary.conversationsBotActive },
      { Indicador: "Tarefas concluidas", Valor: overview.summary.tasksCompleted },
      { Indicador: "Despesas totais", Valor: overview.summary.expensesTotal },
      { Indicador: "Despesas pagas", Valor: overview.summary.expensesPaid },
      { Indicador: "Despesas pendentes", Valor: overview.summary.expensesPending },
      { Indicador: "Despesas atrasadas", Valor: overview.summary.expensesOverdue },
      { Indicador: "Periodo", Valor: overview.range.label },
    ]), "Resumo");
    utils.book_append_sheet(workbook, utils.json_to_sheet(overview.leadOwners.map((item) => ({
      Funcionario: item.userName,
      Leads: item.totalLeads,
      Ganhos: item.wonLeads,
      EmAberto: item.openLeads,
      Receita: item.revenue,
    }))), "Funcionarios");
    utils.book_append_sheet(workbook, utils.json_to_sheet(overview.planSales.map((item) => ({
      Plano: item.planName,
      Vendas: item.count,
      Receita: item.totalValue,
    }))), "Planos");
    utils.book_append_sheet(workbook, utils.json_to_sheet(overview.leadStatuses.map((item) => ({
      Status: item.label,
      Total: item.count,
    }))), "StatusLeads");
    utils.book_append_sheet(workbook, utils.json_to_sheet(overview.conversationBreakdown.map((item) => ({
      Categoria: item.label,
      Total: item.count,
    }))), "Conversas");
    utils.book_append_sheet(workbook, utils.json_to_sheet(overview.taskOwners.map((item) => ({
      Funcionario: item.userName,
      Total: item.total,
      Concluidas: item.completed,
      Pendentes: item.pending,
    }))), "Tarefas");
    utils.book_append_sheet(workbook, utils.json_to_sheet(overview.expenseBreakdown.map((item) => ({
      Status: item.label,
      Quantidade: item.count,
      Total: item.totalAmount,
    }))), "Despesas");
    utils.book_append_sheet(workbook, utils.json_to_sheet(overview.timeline.map((item) => ({
      Periodo: item.label,
      Leads: item.leads,
      Vendas: item.sales,
      Conversas: item.conversations,
      Tarefas: item.tasks,
      Despesas: item.expenses,
    }))), "Timeline");

    const buffer = write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await logAudit({
      userId: user.id,
      action: "EXPORT",
      module: "overview",
      description: "Exportacao da visao geral em XLSX.",
      metadata: { preset: filters.preset, range: overview.range.label },
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="visao-geral-clickhub.xlsx"`,
      },
    });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse("Nao foi possivel exportar a visao geral."), { status: 500 });
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
