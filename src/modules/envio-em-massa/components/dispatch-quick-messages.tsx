"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MessageSquareText, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type QuickMessage = { id: string; body: string; ownerUserId: string };

export function DispatchQuickMessages({ conversationId, onSelect }: { conversationId: string; onSelect: (body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QuickMessage[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch(`/api/envio-em-massa/mensagens-rapidas?conversationId=${conversationId}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "Não foi possível carregar as mensagens rápidas.");
    setItems(result.data);
  }

  useEffect(() => { if (open) void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Falha ao carregar.")); }, [open, conversationId]);

  async function mutate(action: "save" | "delete", id: string) {
    if (busy) return;
    if (action === "delete" && !window.confirm("Excluir esta mensagem rápida?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/envio-em-massa/mensagens-rapidas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, action, id, ...(action === "save" ? { body } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Não foi possível atualizar.");
      await load();
      if (action === "save") { setEditing(null); setBody(""); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao atualizar mensagens rápidas.");
    } finally { setBusy(false); }
  }

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><Button variant="outline" size="sm" className="h-9 rounded-xl text-xs"><MessageSquareText className="h-4 w-4" />Mensagens rápidas</Button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl">
        <Dialog.Title className="text-lg font-semibold">Mensagens rápidas</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-muted-foreground">Crie textos prontos e clique em um deles para preencher a mensagem.</Dialog.Description>
        <Dialog.Close asChild><Button aria-label="Fechar mensagens rápidas" variant="ghost" size="icon" className="absolute right-3 top-3"><X className="h-4 w-4" /></Button></Dialog.Close>
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        <form className="my-5 space-y-3 rounded-xl border p-4" onSubmit={(event) => { event.preventDefault(); void mutate("save", editing ?? crypto.randomUUID()); }}>
          <p className="text-sm font-semibold">{editing ? "Editar mensagem" : "Criar mensagem"}</p>
          <Textarea aria-label="Texto da mensagem rápida" value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} required placeholder="Digite a mensagem pronta..." className="min-h-24 resize-y" />
          <div className="flex gap-2"><Button size="sm" disabled={busy || !body.trim()}>{editing ? "Salvar alterações" : "Criar mensagem"}</Button>{editing ? <Button size="sm" variant="ghost" type="button" onClick={() => { setEditing(null); setBody(""); }}>Cancelar</Button> : null}</div>
        </form>
        <div className="space-y-2">
          {items.map((item) => <div key={item.id} className="flex items-start gap-2 rounded-xl border p-3"><button type="button" className="min-w-0 flex-1 whitespace-pre-wrap break-words text-left text-sm leading-5 hover:text-primary" onClick={() => { onSelect(item.body); setOpen(false); }}>{item.body}</button><Button variant="ghost" size="icon" aria-label="Editar mensagem rápida" disabled={busy} onClick={() => { setEditing(item.id); setBody(item.body); }}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label="Excluir mensagem rápida" disabled={busy} onClick={() => void mutate("delete", item.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)}
          {!items.length ? <p className="text-sm text-muted-foreground">Crie sua primeira mensagem rápida acima.</p> : null}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
