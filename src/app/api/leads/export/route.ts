import { NextResponse } from "next/server";
import { utils, write } from "xlsx";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/constants/permissions";
import { leadSourceLabel } from "@/modules/leads/types/lead-source";
import { leadSourceWhere } from "@/lib/lead-source-access";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.leadsExport);

    const agentScope = new URL(request.url).searchParams.get("agent");
    const leads = await prisma.lead.findMany({
      where: { deletedAt: null, ...leadSourceWhere(user, agentScope ?? undefined), ...(user.role === "EMPLOYEE" ? { assignedUserId: user.id } : {}) },
      include: { assignedUser: true, plan: true, kanbanStage: true },
      orderBy: { createdAt: "desc" },
    });

    const rows = leads.map((lead) => ({
      IdCliente: lead.customerCode,
      Nome: lead.name,
      WhatsApp: lead.phone,
      Email: lead.email ?? "",
      NomeMae: lead.motherName ?? "",
      CPF: lead.cpfCnpj ?? "",
      DataNascimento: lead.birthDate?.toISOString().slice(0, 10) ?? "",
      Status: lead.kanbanStage?.name ?? lead.status,
      Origem: leadSourceLabel(lead.source),
      Rua: lead.address ?? "",
      Numero: lead.streetNumber ?? "",
      Complemento: lead.complement ?? "",
      Bairro: lead.neighborhood ?? "",
      CEP: lead.cep ?? "",
      Cidade: lead.city ?? "",
      UF: lead.state ?? "",
      Plano: lead.planName ?? lead.plan?.name ?? "",
      ValorPlano: Number(lead.planValue ?? lead.expectedValue ?? lead.plan?.price ?? 0),
      DataVencimento: lead.billingDueDay ?? "",
      Responsavel: lead.assignedUser?.name ?? "",
      Valor: Number(lead.expectedValue ?? 0),
      Observacao: lead.notes ?? "",
      CriadoEm: lead.createdAt.toISOString(),
    }));

    const workbook = utils.book_new();
    const sheet = utils.json_to_sheet(rows);
    utils.book_append_sheet(workbook, sheet, "Leads");
    const buffer = write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await logAudit({
      userId: user.id,
      action: "EXPORT",
      module: "leads",
      description: "Exportacao de leads em XLSX.",
      metadata: { total: leads.length },
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leads-clickhub.xlsx"`,
      },
    });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(errorResponse("Nao foi possivel exportar os leads."), { status: 500 });
  }
}
