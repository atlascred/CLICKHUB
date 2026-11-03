"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { navigationItems } from "@/config/navigation";
import { useCurrentUser } from "@/hooks/use-current-user";

const sections = [
  { title: "Inteligência comercial", paths: ["/dashboard", "/visao-geral"] },
  { title: "Relacionamento & vendas", paths: ["/conversas", "/verificar-whatsapp", "/saude-evolution", "/envio-em-massa", "/leads", "/compromissos", "/despesas", "/sdr-por-voz"] },
  { title: "Gestão do workspace", paths: ["/n8n", "/usuarios", "/ceps", "/configuracoes"] },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { data: user } = useCurrentUser();
  const visibleItems = navigationItems.filter(
    (item) => user?.role === "ADMIN" || ("employeeVisible" in item) || (!("adminOnly" in item) && Boolean(user?.permissions?.[item.permission])),
  );

  return (
    <aside className="crm-sidebar fixed inset-y-0 left-0 z-40 hidden w-64 text-white md:block">
      <div className="flex h-full flex-col">
        <div className="flex h-20 shrink-0 items-center gap-3 border-b border-white/10 px-5">
          <BrandLogo compact priority />
          <div><p className="text-sm font-extrabold tracking-[0.08em]">CLICKHUB</p><p className="mt-1 text-[10px] font-medium tracking-[0.14em] text-blue-200">CRM · Comercial</p></div>
        </div>
        <button type="button" onClick={onToggle} aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expandir sidebar" : "Recolher sidebar"} className="mx-4 mt-3 flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 text-xs text-blue-100 transition-colors hover:bg-white/10">{collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /><span>Recolher menu</span></>}</button>
        <nav aria-label="Navegação principal" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {sections.map((section) => {
            const items = visibleItems.filter((item) => section.paths.includes(item.href));
            if (!items.length) return null;
            return <div key={section.title}>
              <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.16em] text-blue-200/65">{section.title}</p>
              <div className="space-y-1">{items.map((item) => {
                const active = pathname === item.href;
                const disabled = "comingSoon" in item && item.comingSoon;
                const content = <>
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${active ? "bg-white/20 text-white" : "bg-white/5 text-blue-200/80"}`}><item.icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1 leading-snug">{item.title}</span>
                  {disabled ? <span className="whitespace-nowrap rounded-full border border-white/15 px-1.5 py-0.5 text-[8px]">Em breve</span> : null}
                  {"badgeLabel" in item ? <span className="rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-emerald-200">{item.badgeLabel}</span> : null}
                  {active ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-blue-100" /> : null}
                </>;
                const className = `relative flex items-center gap-2 rounded-xl border px-2.5 py-2 text-[12px] font-medium transition-colors ${disabled ? "border-transparent text-blue-200/50" : active ? "border-blue-300/30 bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-950/25" : "border-transparent text-blue-100/85 hover:border-white/10 hover:bg-white/5 hover:text-white"}`;
                return disabled ? <div key={item.href} aria-disabled="true" aria-label={`${item.title} · Em breve`} title={`${item.title} · Em breve`} className={className}>{content}</div> : <Link key={item.href} href={item.href} title={item.title} aria-label={item.title} aria-current={active ? "page" : undefined} className={className}>{content}</Link>;
              })}</div>
            </div>;
          })}
        </nav>
        <div className="shrink-0 border-t border-white/10 bg-black/10 p-4">
          <Link href="/configuracoes" aria-label="Perfil e configurações" title="Perfil e configurações" className="flex items-center gap-3 rounded-lg p-1 hover:bg-white/5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-blue-300/30 bg-blue-500/20 text-xs font-bold text-blue-100">{user?.name?.slice(0, 1) ?? "A"}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{user?.name ?? "Usuário"}</span><span className="text-[10px] text-blue-200/70">{user?.role === "ADMIN" ? "Administrador" : "Operador"}</span></span>
            <ArrowUpRight className="h-4 w-4 text-blue-200/70" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
