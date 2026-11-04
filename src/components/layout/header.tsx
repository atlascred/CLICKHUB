"use client";

import { useEffect, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { Settings, Moon, Sun, ChevronRight, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import { navigationItems } from "@/config/navigation";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Button } from "@/components/ui/button";
import { clearCurrentUserCache, useCurrentUser } from "@/hooks/use-current-user";

type HeaderProps = {
  title: string;
};

export function Header({ title }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const PageIcon = navigationItems.find((item) => item.href === pathname)?.icon;
  const currentUser = useCurrentUser();
  const { data: user } = currentUser;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === "dark";
  const appliedPreference = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const preference = `${user.id}:${user.theme}`;
    if (appliedPreference.current === preference) return;
    appliedPreference.current = preference;
    setTheme(user.theme === "dark" ? "dark" : "light");
  }, [setTheme, user?.id, user?.theme]);

  async function toggleTheme() {
    const nextTheme = isDark ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.style.colorScheme = nextTheme;
    if (user?.id === "visual-preview") return;
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: nextTheme }),
    });
    await currentUser.refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearCurrentUserCache();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-primary/15 bg-card/95 shadow-sm backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between px-4 md:h-16 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo compact className="h-8 w-8 md:hidden" imageClassName="p-0.5" />
          {PageIcon ? <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary md:grid"><PageIcon className="h-4 w-4" /></span> : null}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm"><span className="hidden text-muted-foreground lg:inline">Workspace</span><ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground/50 lg:block" /><h1 className="truncate font-bold">{title}</h1></div>
            {user?.id === "visual-preview" ? <p className="mt-1 text-[10px] font-medium text-primary">Prévia local · dados demonstrativos</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <Button
            className="hidden md:inline-flex"
            variant="outline"
            size="icon"
            type="button"
            aria-label="Alternar tema"
            title="Alternar tema"
            onClick={() => void toggleTheme()}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium">{user?.name ?? "Usuário"}</p>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={logout} type="button">
              Sair
            </button>
          </div>
          <div className="hidden h-9 w-9 place-items-center rounded-full border border-primary/15 bg-primary/10 text-sm font-bold text-primary md:grid">
            {(user?.name ?? "A").slice(0, 1).toUpperCase()}
          </div>
          <Menu.Root><Menu.Trigger type="button" aria-label="Menu da conta" className="grid h-11 w-11 place-items-center rounded-full border border-primary/15 bg-primary/10 text-sm font-bold text-primary md:hidden">{(user?.name ?? "A").slice(0, 1).toUpperCase()}</Menu.Trigger><Menu.Portal><Menu.Content align="end" sideOffset={10} collisionPadding={12} className="z-[80] w-64 rounded-2xl border bg-popover p-2 text-popover-foreground shadow-xl"><div className="border-b px-3 py-3"><p className="truncate text-sm font-bold">{user?.name ?? "Sua conta"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{user?.email}</p></div><Menu.Item asChild className="mt-1 flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent"><Link href="/configuracoes"><Settings className="h-4 w-4" />Perfil e configurações</Link></Menu.Item><Menu.Item onSelect={() => void toggleTheme()} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}Usar tema {isDark ? "claro" : "escuro"}</Menu.Item><Menu.Item onSelect={() => void logout()} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-destructive outline-none data-[highlighted]:bg-destructive/10"><LogOut className="h-4 w-4" />Sair da conta</Menu.Item></Menu.Content></Menu.Portal></Menu.Root>
        </div>
      </div>
    </header>
  );
}
