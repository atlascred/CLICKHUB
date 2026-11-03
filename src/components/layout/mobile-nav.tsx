"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Grid2X2, X } from "lucide-react";
import { navigationItems } from "@/config/navigation";
import { useCurrentUser } from "@/hooks/use-current-user";

const primaryPaths = ["/dashboard", "/conversas", "/leads", "/compromissos"];
const shortLabels: Record<string, string> = { "/dashboard": "Início", "/compromissos": "Agenda" };

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { data: user } = useCurrentUser();
  const visibleItems = navigationItems.filter(
    (item) => user?.role === "ADMIN" || ("employeeVisible" in item) || (!("adminOnly" in item) && Boolean(user?.permissions?.[item.permission])),
  );
  const primary = primaryPaths.flatMap((path) => visibleItems.filter((item) => item.href === path));
  const secondary = visibleItems.filter((item) => !primaryPaths.includes(item.href));
  const moreActive = secondary.some((item) => item.href === pathname);
  const tabClass = (active: boolean) => `flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <nav aria-label="Navegação móvel" className="crm-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-primary/10 bg-card/95 px-2 pt-1 shadow-[0_-4px_20px_hsl(var(--primary)/0.06)] backdrop-blur-xl md:hidden">
        <div className="flex gap-1">
          {primary.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={tabClass(pathname === item.href)}>
            <item.icon className="h-5 w-5" aria-hidden="true" />
            <span>{shortLabels[item.href] ?? item.title}</span>
          </Link>)}
          <Dialog.Trigger className={tabClass(moreActive)} aria-label="Mais opções de navegação">
            <Grid2X2 className="h-5 w-5" aria-hidden="true" /><span>Mais</span>
          </Dialog.Trigger>
        </div>
      </nav>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-3xl border bg-card px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:mx-auto sm:max-w-lg">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div><Dialog.Title className="text-lg font-bold">Seu workspace</Dialog.Title><Dialog.Description className="mt-1 text-xs text-muted-foreground">Todas as ferramentas da Click Hubnet.</Dialog.Description></div>
            <Dialog.Close aria-label="Fechar menu" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted"><X className="h-5 w-5" /></Dialog.Close>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {secondary.map((item) => {
              const disabled = "comingSoon" in item && item.comingSoon;
              const content = <><item.icon className="h-5 w-5 text-primary" aria-hidden="true" /><span className="text-xs font-semibold">{item.title}</span>{disabled ? <span className="text-[10px] text-muted-foreground">Em breve</span> : "badgeLabel" in item ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">{item.badgeLabel}</span> : null}</>;
              const classes = `flex min-h-24 flex-col items-start justify-center gap-2 rounded-xl border p-3 ${disabled ? "opacity-50" : pathname === item.href ? "border-primary/30 bg-primary/10" : "bg-muted/30 hover:bg-accent"}`;
              return disabled ? <div key={item.href} aria-disabled="true" className={classes}>{content}</div> : <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={pathname === item.href ? "page" : undefined} className={classes}>{content}</Link>;
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
