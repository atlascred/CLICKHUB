"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, PlusSquare, Share, Smartphone } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function InstallApp({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const update = () => setInstalled(display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    update();
    display.addEventListener("change", update);
    return () => display.removeEventListener("change", update);
  }, []);
  if (compact && installed) return null;
  const trigger = <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100"><Smartphone className="h-4 w-4" />Instalar no iPhone</button>;
  return <>
    {compact ? <div className="mt-4 text-center">{trigger}</div> : <Card><CardHeader><CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" />Aplicativo CLICKHUB</CardTitle><CardDescription>Acesse direto pela Tela de Início, em uma janela própria.</CardDescription></CardHeader><CardContent>{installed ? <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Você está usando o aplicativo.</p> : trigger}<p className="mt-3 text-xs leading-5 text-muted-foreground">É necessário estar conectado à internet para consultar e atualizar os dados.</p></CardContent></Card>}
    <BottomSheet open={open} onOpenChange={setOpen} title="CLICKHUB no seu iPhone" description="Adicione o aplicativo usando o Safari.">
      <div className="mb-5 flex items-center gap-3 rounded-2xl bg-muted p-4"><img src="/pwa/apple-touch-icon.png" alt="" width={56} height={56} className="rounded-xl" /><div><p className="font-bold">CLICKHUB</p><p className="text-xs text-muted-foreground">Conversas, leads e vendas</p></div></div>
      <ol className="space-y-4 text-sm leading-6"><li><strong>1.</strong> Abra este endereço no <strong>Safari</strong> do iPhone.</li><li><strong>2.</strong> Toque em <Share className="inline h-4 w-4" aria-hidden="true" /> <strong>Compartilhar</strong>. Dependendo da versão do iOS, essa opção fica dentro do menu do navegador.</li><li><strong>3.</strong> Escolha <PlusSquare className="inline h-4 w-4" aria-hidden="true" /> <strong>Adicionar à Tela de Início</strong>.</li><li><strong>4.</strong> Se aparecer <strong>Abrir como App da Web</strong>, deixe ativado. Toque em <strong>Adicionar</strong>.</li></ol>
      <p className="mt-5 rounded-xl border p-3 text-xs leading-5 text-muted-foreground">Depois, abra pelo ícone CLICKHUB na Tela de Início e entre com sua conta. A instalação é gratuita e dispensa a App Store.</p>
    </BottomSheet>
  </>;
}
