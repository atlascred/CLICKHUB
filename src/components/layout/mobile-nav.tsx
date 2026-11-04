"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Menu, Search } from "lucide-react";
import { navigationItems } from "@/config/navigation";
import { useCurrentUser } from "@/hooks/use-current-user";
import { BottomSheet } from "@/components/ui/bottom-sheet";
const primaryPaths = ["/dashboard", "/conversas", "/leads"];
const groups = [
  { title: "Seu dia a dia", paths: ["/compromissos", "/visao-geral", "/despesas"] },
  { title: "WhatsApp e cobertura", paths: ["/envio-em-massa", "/verificar-whatsapp", "/saude-evolution", "/ceps", "/sdr-por-voz"] },
  { title: "Gestão", paths: ["/usuarios", "/n8n", "/configuracoes"] },
];
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: user } = useCurrentUser();
  const visibleItems = navigationItems.filter(item => user?.role === "ADMIN" || ("employeeVisible" in item) || (!("adminOnly" in item) && Boolean(user?.permissions?.[item.permission])));
  const primary = primaryPaths.flatMap(path => visibleItems.filter(item => item.href === path));
  const secondary = visibleItems.filter(item => !primaryPaths.includes(item.href));
  const moreActive = secondary.some(item => item.href === pathname);
  const tabClass = (active: boolean) => `flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors ${active ? "text-primary" : "text-muted-foreground"}`;
  function changeOpen(value: boolean) { setOpen(value); if (!value) setQuery(""); }
  const matching = secondary.filter(item => item.title.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  return <>
    <nav aria-label="Navegação móvel" className="crm-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/95 px-3 shadow-[0_-8px_30px_hsl(var(--foreground)/0.04)] backdrop-blur-xl md:hidden"><div className="mx-auto flex max-w-lg items-center gap-2">{primary.map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={tabClass(pathname === item.href)}><span className={`grid h-8 w-14 place-items-center rounded-full ${pathname === item.href ? "bg-primary/10" : ""}`}><item.icon className="h-5 w-5" aria-hidden="true" /></span><span>{item.href === "/dashboard" ? "Início" : item.title}</span></Link>)}<button type="button" className={tabClass(moreActive || open)} aria-label="Abrir menu de navegação" aria-expanded={open} onClick={() => changeOpen(true)}><span className={`grid h-8 w-14 place-items-center rounded-full ${moreActive || open ? "bg-primary/10" : ""}`}><Menu className="h-5 w-5" /></span><span>Menu</span></button></div></nav>
    <BottomSheet open={open} onOpenChange={changeOpen} title="Explorar" description="Encontre as ferramentas do seu trabalho."><div className="relative mb-5"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><input aria-label="Buscar no menu" placeholder="Buscar ferramenta" value={query} onChange={e => setQuery(e.target.value)} className="h-12 w-full rounded-xl border bg-muted/40 pl-10 pr-3 text-base outline-none focus:ring-2 focus:ring-ring" /></div><div className="space-y-5">{groups.map(group => {
      const items = matching.filter(item => group.paths.includes(item.href)); if (!items.length) return null;
      return <section key={group.title}><h3 className="mb-1 px-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{group.title}</h3><div className="divide-y divide-border/50">{items.map(item => {
        const disabled = "comingSoon" in item && item.comingSoon;
        const content = <><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${pathname === item.href ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><item.icon className="h-5 w-5" /></span><span className="min-w-0 flex-1 text-sm font-semibold">{item.title}</span>{disabled ? <span className="text-[10px] text-muted-foreground">Em breve</span> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}</>;
        return disabled ? <div key={item.href} aria-disabled="true" className="flex min-h-16 items-center gap-3 py-2 opacity-50">{content}</div> : <Link key={item.href} href={item.href} onClick={() => changeOpen(false)} aria-current={pathname === item.href ? "page" : undefined} className="flex min-h-16 items-center gap-3 rounded-xl py-2 active:bg-accent">{content}</Link>;
      })}</div></section>;
    })}{!matching.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma ferramenta encontrada.</p> : null}</div></BottomSheet>
  </>;
}
