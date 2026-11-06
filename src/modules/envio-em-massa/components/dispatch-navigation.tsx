"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, Megaphone, MessageCircleMore } from "lucide-react";
export function DispatchNavigation() {
 const pathname=usePathname();
 return <nav aria-label="WhatsApp Oficial" className="mb-4 flex gap-2 overflow-x-auto pb-1">{[{href:"/envio-em-massa",label:"Disparos",icon:Megaphone},{href:"/envio-em-massa/conversas",label:"Conversas de Disparo",icon:MessageCircleMore},{href:"/envio-em-massa/historico",label:"Histórico",icon:History}].map(item=><Link key={item.href} href={item.href} aria-current={pathname===item.href?"page":undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-medium ${pathname===item.href?"border-primary bg-primary text-primary-foreground":"bg-card text-muted-foreground hover:text-foreground"}`}><item.icon className="h-4 w-4"/>{item.label}</Link>)}</nav>;
}
