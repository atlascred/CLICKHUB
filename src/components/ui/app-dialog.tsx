"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
export function AppDialog({ title, description, children, onClose, drawer = false, closeLabel = "Fechar", className }: { title: string; description?: string; children: ReactNode; onClose: () => void; drawer?: boolean; closeLabel?: string; className?: string }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" /><Dialog.Content className={cn("crm-dialog fixed z-50 flex w-full flex-col border bg-card shadow-2xl", drawer ? "inset-y-0 right-0 h-[100dvh] max-w-2xl" : "inset-x-0 bottom-0 max-h-[calc(100dvh-12px)] rounded-t-3xl md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[90dvh] md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl", className)}>
    <div className="flex shrink-0 items-start justify-between gap-4 border-b p-4 sm:p-5"><div className="min-w-0"><Dialog.Title className="truncate text-lg font-bold">{title}</Dialog.Title><Dialog.Description className={description ? "mt-1 text-sm text-muted-foreground" : "sr-only"}>{description || "Preencha ou consulte as informações desta janela."}</Dialog.Description></div><Dialog.Close aria-label={closeLabel} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted"><X className="h-5 w-5" /></Dialog.Close></div><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5">{children}</div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
