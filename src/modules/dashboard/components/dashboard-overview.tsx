"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const statusLabels: Record<string, string> = {
  NEW: "Novo",
  CONTACTED: "Contato",
  QUALIFIED: "Qualificado",
  PROPOSAL: "Proposta",
  WON: "Fechado",
  LOST: "Perdido",
};

const statusOrder = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
const statusTones: Record<string, string> = {
  NEW: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  CONTACTED: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  QUALIFIED: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  PROPOSAL: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  WON: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  LOST: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};
const chartColors = ["#225eea", "#628bea", "#a4bcf2", "#12346a", "#268878", "#9ba9be"];
const tooltipStyle = { borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontSize: 12, boxShadow: "0 8px 32px #10234212" };

export type DashboardOverviewData = {
  leadStatuses: Array<{ status: string; count: number }>;
  leadChart: Array<{ date: string; label: string; count: number }>;
  planSales: Array<{ planId: string | null; planName: string; count: number; totalValue: number }>;
  recentLeads: Array<{
    id: string;
    name: string;
    phone: string;
    status: string;
    city: string | null;
    state: string | null;
    planName: string | null;
    assignedUserName: string | null;
    expectedValue: number;
    createdAt: string;
  }>;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function DashboardOverview({ data, loading }: { data: DashboardOverviewData | null; loading: boolean }) {
  const funnelData = statusOrder.map((status) => ({
    status,
    label: statusLabels[status],
    count: data?.leadStatuses.find((item) => item.status === status)?.count ?? 0,
  }));

  const statusData = funnelData.map((item) => ({
    name: item.label,
    value: item.count,
  }));

  const chartData = data?.leadChart ?? [];
  const planData = data?.planSales ?? [];

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Evolução das oportunidades</CardTitle>
            <CardDescription>Entradas de leads no intervalo selecionado</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: -20, right: 12, top: 8, bottom: 0 }}>
                  <defs><linearGradient id="lead-area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#225eea" stopOpacity={0.2} /><stop offset="100%" stopColor="#225eea" stopOpacity={0.01} /></linearGradient></defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area name="Leads" type="monotone" dataKey="count" stroke="#225eea" strokeWidth={3} fill="url(#lead-area-fill)" activeDot={{ r: 5, stroke: "white", strokeWidth: 3 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Seu funil, em perspectiva</CardTitle>
            <CardDescription>Distribuição atual dos leads por etapa</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-60">
              {statusData.some((item) => item.value > 0) ? <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="text-3xl font-extrabold tracking-tight tabular-nums">{statusData.reduce((sum, item) => sum + item.value, 0).toLocaleString("pt-BR")}</strong><span className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Oportunidades</span></div> : null}
              {!statusData.some((item) => item.value > 0) ? <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">{loading ? "Carregando distribuição..." : "Nenhum lead neste período"}</div> : null}
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={96} paddingAngle={3} stroke="hsl(var(--card))" isAnimationActive={false}>
                    {statusData.map((entry, index) => (
                      <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {funnelData.map((item, index) => (
                <div key={item.status} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: chartColors[index % chartColors.length] }}
                    />
                    {item.label}
                  </span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Últimas conexões</CardTitle>
            <CardDescription>As oportunidades mais recentes da sua operação</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-md border">
              {loading ? (
                <p className="p-4 text-sm text-muted-foreground">Carregando</p>
              ) : data?.recentLeads.length ? (
                data.recentLeads.map((lead) => (
                  <div key={lead.id} className="grid gap-3 p-4 text-sm transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_130px_110px]">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/5 text-xs font-bold text-primary">{lead.name.split(" ").filter(Boolean).slice(0, 2).map((name) => name[0]).join("")}</span>
                      <div className="min-w-0"><p className="truncate font-semibold">{lead.name}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{lead.phone}</p></div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <p>{lead.planName ?? "Sem plano"}</p>
                      <p>{lead.assignedUserName ?? "Sem responsavel"}</p>
                    </div>
                    <div className="text-xs text-muted-foreground md:text-right">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${statusTones[lead.status] ?? "bg-muted text-muted-foreground"}`}>{statusLabels[lead.status] ?? lead.status}</span>
                      <p className="mt-1.5 font-semibold text-foreground">{currency.format(lead.expectedValue)}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Sem leads cadastrados</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Planos em destaque</CardTitle>
            <CardDescription>Quantidade e valor total por plano fechado</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {planData.length ? (
              planData.map((item, index) => (
                <div key={item.planId ?? item.planName} className="rounded-md border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.planName}</span>
                    <span className="font-semibold">{currency.format(item.totalValue)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.count} venda(s)</p>
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${item.count / Math.max(1, ...planData.map((plan) => plan.count)) * 100}%`,
                        backgroundColor: chartColors[index % chartColors.length],
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Sem planos vendidos
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
