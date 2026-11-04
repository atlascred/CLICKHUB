"use client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
export type ActionMenuItem = { label: string; icon?: ReactNode; onSelect?: () => void; href?: string; external?: boolean; disabled?: boolean; destructive?: boolean };
export function ActionMenu({ label, items, className }: { label: string; items: ActionMenuItem[]; className?: string }) {
  return <Menu.Root><Menu.Trigger type="button" aria-label={label} title={label} className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", className)}><MoreHorizontal className="h-5 w-5" aria-hidden="true" /></Menu.Trigger><Menu.Portal><Menu.Content align="end" sideOffset={8} collisionPadding={12} className="z-[80] max-h-[70dvh] min-w-56 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-xl">{items.map(item => <Menu.Item key={item.label} disabled={item.disabled} onSelect={item.onSelect} asChild={Boolean(item.href)} className={cn("flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40",item.destructive && "text-destructive")}>
    {item.href ? <a href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined}>{item.icon}<span>{item.label}</span></a> : <>{item.icon}<span>{item.label}</span></>}
  </Menu.Item>)}</Menu.Content></Menu.Portal></Menu.Root>;
}
