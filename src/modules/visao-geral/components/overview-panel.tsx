"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarDays,
  Download,
  FileText,
  UserSquare2,
} from "lucide-react";
import { CompactSection } from "@/components/shared/compact-section";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApiResource } from "@/hooks/use-api-resource";

type OverviewData = {
  range: {
    preset: string;
    from: string;
    to: string;
    label: string;
  };
  summary: {
    leadsCreated: number;
    leadsWon: number;
    revenue: number;
    conversationsFinished: number;
    conversationsAssumed: number;
    conversationsBotActive: number;
    tasksCompleted: number;
    expensesTotal: number;
    expensesPaid: number;
    expensesPending: number;
    expensesOverdue: number;
  };
  leadStatuses: Array<{ status: string; label: string; count: number }>;
  planSales: Array<{ planName: string; count: number; totalValue: number }>;
  leadOwners: Array<{ userId: string; userName: string; totalLeads: number; wonLeads: number; openLeads: number; revenue: number }>;
  conversationBreakdown: Array<{ key: string; label: string; count: number }>;
  taskOwners: Array<{ userId: string; userName: string; total: number; completed: number; pending: number }>;
  expenseBreakdown: Array<{ status: string; label: string; count: number; totalAmount: number }>;
  timeline: Array<{ label: string; leads: number; sales: number; conversations: number; tasks: number; expenses: number }>;
};

const periodOptions = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
  { value: "quarter", label: "3 meses" },
  { value: "semester", label: "6 meses" },
  { value: "year", label: "1 ano" },
  { value: "custom", label: "Período" },
];

const chartColors = ["#0ea5e9", "#2563eb", "#14b8a6", "#f59e0b", "#8b5cf6", "#f97316"];

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function OverviewPanel() {
  const [period, setPeriod] = useState("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedPeriod, setAppliedPeriod] = useState("month");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  const overviewUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("preset", appliedPeriod);
    if (appliedPeriod === "custom" && appliedFrom) params.set("from", appliedFrom);
    if (appliedPeriod === "custom" && appliedTo) params.set("to", appliedTo);
    return `/api/overview?${params.toString()}`;
  }, [appliedFrom, appliedPeriod, appliedTo]);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("preset", appliedPeriod);
    if (appliedPeriod === "custom" && appliedFrom) params.set("from", appliedFrom);
    if (appliedPeriod === "custom" && appliedTo) params.set("to", appliedTo);
    return `/api/overview/export?${params.toString()}`;
  }, [appliedFrom, appliedPeriod, appliedTo]);

  const overview = useApiResource<OverviewData>(overviewUrl);
  const customPeriod = period === "custom";
  const data = overview.data;

  function applyFilters() {
    setAppliedPeriod(period);
    setAppliedFrom(period === "custom" ? from : "");
    setAppliedTo(period === "custom" ? to : "");
  }

  function clearFilters() {
    setPeriod("month");
    setFrom("");
    setTo("");
    setAppliedPeriod("month");
    setAppliedFrom("");
    setAppliedTo("");
  }

  function exportPdf() {
    if (!data) return;

    const printWindow = window.open("", "_blank", "width=1280,height=900");
    if (!printWindow) return;

    const rows = [
      ["Leads criados", String(data.summary.leadsCreated)],
      ["Leads ganhos", String(data.summary.leadsWon)],
      ["Receita", currency.format(data.summary.revenue)],
      ["Conversas finalizadas", String(data.summary.conversationsFinished)],
      ["Conversas assumidas", String(data.summary.conversationsAssumed)],
      ["Tarefas concluídas", String(data.summary.tasksCompleted)],
      ["Despesas totais", currency.format(data.summary.expensesTotal)],
    ]
      .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
      .join("");

    const employees = data.leadOwners.length
      ? data.leadOwners
          .map((item) => `<tr><td>${escapeHtml(item.userName)}</td><td>${item.totalLeads}</td><td>${item.wonLeads}</td><td>${currency.format(item.revenue)}</td></tr>`)
          .join("")
      : `<tr><td colspan="4">Sem dados no período.</td></tr>`;

    const plans = data.planSales.length
      ? data.planSales
          .map((item) => `<tr><td>${escapeHtml(item.planName)}</td><td>${item.count}</td><td>${currency.format(item.totalValue)}</td></tr>`)
          .join("")
      : `<tr><td colspan="3">Sem dados no período.</td></tr>`;

    printWindow.document.write(`<!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <title>Visão Geral - CLICKHUB</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
            h1, h2 { margin: 0 0 12px; }
            p { color: #475569; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
            .card { border: 1px solid #cbd5e1; border-radius: 16px; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 0; text-align: left; font-size: 14px; }
          </style>
        </head>
        <body>
          <h1>Visão Geral CLICKHUB</h1>
          <p>Período: ${escapeHtml(data.range.label)}</p>
          <div class="grid">
            <div class="card">
              <h2>Resumo</h2>
              <table><tbody>${rows}</tbody></table>
            </div>
            <div class="card">
              <h2>Planos vendidos</h2>
              <table><thead><tr><th>Plano</th><th>Vendas</th><th>Receita</th></tr></thead><tbody>${plans}</tbody></table>
            </div>
            <div class="card">
              <h2>Distribuição por funcionário</h2>
              <table><thead><tr><th>Funcionário</th><th>Leads</th><th>Ganhos</th><th>Receita</th></tr></thead><tbody>${employees}</tbody></table>
            </div>
          </div>
        </body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[28px] border border-sky-100 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_36%),linear-gradient(135deg,_#ffffff,_#eff6ff_52%,_#ecfeff)] p-4 md:p-6 shadow-[0_24px_80px_-40px_rgba(2,132,199,0.45)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-700">Visão Geral</p>
            <h2 className="mt-2 text-xl md:text-3xl font-semibold text-slate-950">Panorama completo da operação comercial</h2>
            <p className="mt-3 hidden text-sm leading-6 md:block text-slate-600">
              Distribuição de leads por funcionário, planos vendidos, status, conversas finalizadas pelos chatbots, assumidas, tarefas e despesas em um único lugar.
            </p>
          </div>

          <div className="md:hidden"><ActionMenu label="Exportar relatório" items={[{ label: "Exportar Excel", href: exportUrl, icon: <Download className="h-4 w-4" /> }, { label: "Exportar PDF", icon: <FileText className="h-4 w-4" />, disabled: !data, onSelect: exportPdf }]} /></div>
          <div className="hidden flex-wrap gap-2 md:flex">
            <Button type="button" variant="outline" asChild>
              <a href={exportUrl}>
                <Download className="h-4 w-4" />
                Exportar Excel
              </a>
            </Button>
            <Button type="button" onClick={exportPdf} disabled={!data}>
              <FileText className="h-4 w-4" />
              Exportar PDF
            </Button>
          </div>
        </div>

        <div className="mt-4"><CompactSection title="Período do relatório"><div className="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/80 p-4 backdrop-blur md:p-5">
          <div className="flex flex-wrap gap-2">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-full px-4 py-2 text-sm transition ${period === option.value ? "bg-slate-950 text-white shadow-lg" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
                onClick={() => setPeriod(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] xl:grid-cols-[180px_180px_auto]">
            <label className="grid gap-1 text-xs font-medium text-slate-600"><span>Data inicial</span><Input type="date" disabled={!customPeriod} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label className="grid gap-1 text-xs font-medium text-slate-600"><span>Data final</span><Input type="date" disabled={!customPeriod} value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={applyFilters}>
                <CalendarDays className="h-4 w-4" />
                Aplicar filtro
              </Button>
              <Button type="button" variant="ghost" onClick={clearFilters}>
                Limpar
              </Button>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {data?.range.label ?? "Carregando período selecionado..."}
          </p>
        </div></CompactSection></div>
      </section>

      {overview.error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{overview.error}</div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Resumo executivo do período</CardTitle>
            <CardDescription>Comparativo das principais métricas do relatório filtrado.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: "Leads criados", value: data?.summary.leadsCreated ?? 0 },
                    { name: "Leads ganhos", value: data?.summary.leadsWon ?? 0 },
                    { name: "Conversas finalizadas", value: data?.summary.conversationsFinished ?? 0 },
                    { name: "Conversas assumidas", value: data?.summary.conversationsAssumed ?? 0 },
                    { name: "Tarefas concluídas", value: data?.summary.tasksCompleted ?? 0 },
                  ]}
                  layout="vertical"
                  margin={{ left: 40, right: 12, top: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={150} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 14, 14, 0]}>
                    {[
                      "#0ea5e9",
                      "#14b8a6",
                      "#8b5cf6",
                      "#c084fc",
                      "#f59e0b",
                    ].map((color, index) => (
                      <Cell key={color} fill={color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Receita x despesas</CardTitle>
            <CardDescription>Relatório financeiro do período, incluindo vendido, pago e pendente.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: "Receita vendida", value: data?.summary.revenue ?? 0, fill: "#14b8a6" },
                    { name: "Despesas totais", value: data?.summary.expensesTotal ?? 0, fill: "#f59e0b" },
                    { name: "Despesas pagas", value: data?.summary.expensesPaid ?? 0, fill: "#2563eb" },
                    { name: "Despesas pendentes", value: data?.summary.expensesPending ?? 0, fill: "#f97316" },
                    { name: "Despesas atrasadas", value: data?.summary.expensesOverdue ?? 0, fill: "#ef4444" },
                  ]}
                  margin={{ left: 8, right: 8, top: 10, bottom: 12 }}
                >
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} interval={0} angle={-12} textAnchor="end" height={72} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip formatter={(value) => currency.format(Number(value ?? 0))} />
                  <Bar dataKey="value" radius={[14, 14, 0, 0]}>
                    {[
                      { key: "Receita vendida", fill: "#14b8a6" },
                      { key: "Despesas totais", fill: "#f59e0b" },
                      { key: "Despesas pagas", fill: "#2563eb" },
                      { key: "Despesas pendentes", fill: "#f97316" },
                      { key: "Despesas atrasadas", fill: "#ef4444" },
                    ].map((entry) => (
                      <Cell key={entry.key} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card className="overflow-hidden rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Evolução da operação</CardTitle>
            <CardDescription>Leads, vendas, conversas e tarefas distribuídos ao longo do período filtrado.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.timeline ?? []} margin={{ left: -18, right: 10, top: 20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="leadsGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="salesGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip />
                  <Area type="monotone" dataKey="leads" stroke="#0ea5e9" strokeWidth={3} fill="url(#leadsGradient)" />
                  <Area type="monotone" dataKey="sales" stroke="#14b8a6" strokeWidth={3} fill="url(#salesGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Status dos leads</CardTitle>
            <CardDescription>Leitura rápida do funil no período selecionado.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data?.leadStatuses ?? []} dataKey="count" nameKey="label" innerRadius={62} outerRadius={98} paddingAngle={3}>
                    {(data?.leadStatuses ?? []).map((entry, index) => (
                      <Cell key={entry.status} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-2">
              {(data?.leadStatuses ?? []).map((item, index) => (
                <div key={item.status} className="flex items-center justify-between rounded-2xl border border-slate-200 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
                    {item.label}
                  </span>
                  <strong className="text-slate-950">{item.count}</strong>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Distribuição de leads por funcionário</CardTitle>
            <CardDescription>Mostra quem está recebendo mais leads e quem já converteu melhor.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.leadOwners ?? []} layout="vertical" margin={{ left: 30, right: 10, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis type="category" dataKey="userName" tickLine={false} axisLine={false} width={120} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="totalLeads" radius={[0, 12, 12, 0]} fill="#2563eb" />
                  <Bar dataKey="wonLeads" radius={[0, 12, 12, 0]} fill="#14b8a6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Conversas e operação</CardTitle>
            <CardDescription>Fluxo da Lily, operação humana e custos em um resumo visual.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              {(data?.conversationBreakdown ?? []).map((item, index) => (
                <div key={item.key} className="rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{item.label}</span>
                    <strong className="text-slate-950">{item.count}</strong>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, item.count * 8)}%`,
                        backgroundColor: chartColors[index % chartColors.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-3xl bg-slate-950 p-4 text-white">
              <p className="text-xs uppercase tracking-[0.22em] text-sky-200">Despesas</p>
              <p className="mt-3 text-3xl font-semibold">{currency.format(data?.summary.expensesTotal ?? 0)}</p>
              <div className="mt-4 grid gap-2 text-sm text-slate-300">
                <span>Pagas: {currency.format(data?.summary.expensesPaid ?? 0)}</span>
                <span>Pendentes: {currency.format(data?.summary.expensesPending ?? 0)}</span>
                <span>Atrasadas: {currency.format(data?.summary.expensesOverdue ?? 0)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Planos vendidos</CardTitle>
            <CardDescription>Planos com mais vendas e maior valor fechado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.planSales ?? []).length ? (
              (data?.planSales ?? []).map((item, index) => (
                <div key={item.planName} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-950">{item.planName}</p>
                      <p className="text-xs text-slate-500">{item.count} venda(s)</p>
                    </div>
                    <strong className="text-sm text-slate-950">{currency.format(item.totalValue)}</strong>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, item.count * 14)}%`,
                        backgroundColor: chartColors[index % chartColors.length],
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Sem planos vendidos no período filtrado.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Performance de tarefas</CardTitle>
            <CardDescription>Distribuição das tarefas concluídas e pendentes por responsável.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.taskOwners ?? []} margin={{ left: 0, right: 10, top: 12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="userName" tickLine={false} axisLine={false} fontSize={11} interval={0} angle={-10} textAnchor="end" height={60} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="completed" stackId="tasks" fill="#14b8a6" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="pending" stackId="tasks" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Equipe atribuída</CardTitle>
            <CardDescription>Quem recebeu mais leads e o valor gerado por cada carteira.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.leadOwners ?? []).length ? (
              (data?.leadOwners ?? []).map((item, index) => (
                <div key={item.userId} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: chartColors[index % chartColors.length] }}>
                        <UserSquare2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-950">{item.userName}</p>
                        <p className="text-xs text-slate-500">{item.totalLeads} leads • {item.wonLeads} ganhos • {item.openLeads} em aberto</p>
                      </div>
                    </div>
                  </div>
                  <strong className="text-sm text-slate-950">{currency.format(item.revenue)}</strong>
                </div>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Ainda não há leads atribuídos no período filtrado.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[24px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Despesas por status</CardTitle>
            <CardDescription>Volume financeiro separado entre pago, pendente e atrasado.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.expenseBreakdown ?? []} margin={{ left: 10, right: 10, top: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip formatter={(value) => currency.format(Number(value ?? 0))} />
                  <Bar dataKey="totalAmount" radius={[12, 12, 0, 0]}>
                    {(data?.expenseBreakdown ?? []).map((entry, index) => (
                      <Cell key={entry.status} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(value ?? 0);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
