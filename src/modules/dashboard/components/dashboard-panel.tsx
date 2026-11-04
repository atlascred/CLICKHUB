"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RotateCcw, Search, ArrowUpRight, CalendarDays, ChartNoAxesCombined, MessageCircleMore } from "lucide-react";
import { CompactSection } from "@/components/shared/compact-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardMetrics } from "@/modules/dashboard/components/dashboard-metrics";
import type { DashboardMetricsData } from "@/modules/dashboard/components/dashboard-metrics";
import { DashboardOverview } from "@/modules/dashboard/components/dashboard-overview";
import type { DashboardOverviewData } from "@/modules/dashboard/components/dashboard-overview";
import { useApiResource } from "@/hooks/use-api-resource";

type DashboardData = DashboardMetricsData & DashboardOverviewData;

export function DashboardPanel() {
  const [period, setPeriod] = useState("7");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedPeriod, setAppliedPeriod] = useState("7");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [refreshKey, setRefreshKey] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => setRefreshKey(Date.now());
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("crm:dashboard-refresh", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("crm:dashboard-refresh", refresh);
    };
  }, []);

  const dashboardUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("refresh", String(refreshKey));
    if (appliedPeriod !== "custom") {
      params.set("period", appliedPeriod);
    }
    if (appliedPeriod === "custom" && appliedFrom) params.set("from", appliedFrom);
    if (appliedPeriod === "custom" && appliedTo) params.set("to", appliedTo);
    const query = params.toString();
    return query ? `/api/dashboard?${query}` : "/api/dashboard";
  }, [appliedPeriod, appliedFrom, appliedTo, refreshKey]);

  const customPeriod = period === "custom";
  const dashboard = useApiResource<DashboardData>(dashboardUrl);

  return (
    <div className="space-y-6">
      <section className="crm-intro crm-hero relative isolate overflow-hidden rounded-2xl p-4 text-white sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-40 -z-10 h-[420px] w-[420px] rounded-full border-[60px] border-white/[0.045]" />
        <div className="flex flex-col justify-between gap-7 xl:flex-row xl:items-center">
          <div className="max-w-xl">
            <p className="mb-2 flex items-center gap-2 md:mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-100"><span className="h-1.5 w-1.5 rounded-full bg-blue-200" />Central de resultados · Click Hubnet</p>
            <h2 className="text-xl font-extrabold md:hidden">Seu negócio, em números</h2>
            <h2 className="hidden text-2xl font-extrabold leading-tight tracking-tight sm:text-[32px] md:block">Sua operação conectada.<br /><span className="text-blue-200">Seu próximo resultado, mais perto.</span></h2>
            <p className="mt-3 hidden max-w-md text-sm md:block leading-relaxed text-blue-100/85">Do primeiro contato à venda. Acompanhe oportunidades e transforme conversas em novas conexões.</p>
            <Button asChild className="mt-6 hidden border border-white/25 md:inline-flex bg-white text-blue-900 shadow-sm hover:bg-blue-50"><Link href="/conversas"><MessageCircleMore className="h-4 w-4" />Abrir conversas<ArrowUpRight className="h-4 w-4" /></Link></Button>
          </div>
          <div className="hidden min-w-0 rounded-xl border border-white/20 md:block bg-white/10 p-5 backdrop-blur-sm xl:w-64 xl:shrink-0">
            <div className="flex items-center justify-between gap-5 text-blue-100"><span className="text-xs font-semibold">Oportunidades no gráfico</span><ChartNoAxesCombined className="h-5 w-5 shrink-0" /></div>
            <p className="mt-4 text-4xl font-extrabold tabular-nums">{dashboard.loading ? "..." : dashboard.data ? dashboard.data.leadChart.reduce((sum, point) => sum + point.count, 0).toLocaleString("pt-BR") : "—"}</p>
            <p className="mt-2 text-xs text-blue-100">Entradas no intervalo selecionado</p>
            <div className="mt-5 flex items-end gap-1.5" aria-hidden="true">{(dashboard.data?.leadChart ?? []).slice(-14).map((point) => <span key={point.date} className="flex-1 rounded-t-sm bg-blue-200/70" style={{ height: `${Math.max(2, point.count / Math.max(1, ...(dashboard.data?.leadChart ?? []).map((item) => item.count)) * 40)}px` }} />)}</div>
          </div>
        </div>
      </section>
      {dashboard.error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{dashboard.error}</p> : null}
      <DashboardMetrics data={dashboard.data} loading={dashboard.loading} />
      <CompactSection title="Período e filtros"><div className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:flex-row md:items-end md:justify-between">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />Período do relatório</span>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="180">6 meses</option>
              <option value="365">1 ano</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Data inicial</span>
            <Input disabled={!customPeriod} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Data final</span>
            <Input disabled={!customPeriod} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setAppliedPeriod(period);
              setAppliedFrom(period === "custom" ? from : "");
              setAppliedTo(period === "custom" ? to : "");
            }}
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Atualizar
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFrom("");
              setTo("");
              setPeriod("7");
              setAppliedPeriod("7");
              setAppliedFrom("");
              setAppliedTo("");
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Limpar
          </Button>
        </div>
      </div>

      </CompactSection>
      <DashboardOverview data={dashboard.data} loading={dashboard.loading} />
    </div>
  );
}
