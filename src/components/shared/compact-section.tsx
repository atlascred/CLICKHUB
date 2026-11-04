"use client";
import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
export function CompactSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="min-w-0"><button type="button" className="mb-3 flex min-h-11 w-full items-center gap-2 rounded-xl border bg-card px-4 text-sm font-medium md:hidden" aria-expanded={open} onClick={() => setOpen(!open)}><SlidersHorizontal className="h-4 w-4" />{title}<ChevronDown className={`ml-auto h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></button><div className={open ? "block" : "hidden md:block"}>{children}</div></div>;
}
