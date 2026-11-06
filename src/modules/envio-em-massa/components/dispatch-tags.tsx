"use client";
import { useEffect, useState } from "react";
import { Tag, Pencil, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export type DispatchTag={id:string;label:string;color:string;ownerUserId?:string};
export function DispatchTags({conversationId,tags,onChange}:{conversationId:string;tags:DispatchTag[];onChange:()=>Promise<unknown>}){
  const [open,setOpen]=useState(false);
  const [catalog,setCatalog]=useState<DispatchTag[]>([]);
  const [editing,setEditing]=useState<string|null>(null);
  const [label,setLabel]=useState("");
  const [color,setColor]=useState("#dc2626");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function load(){
    const response=await fetch("/api/envio-em-massa/etiquetas?conversationId="+conversationId,{cache:"no-store"});
    const result=await response.json();
    if(!response.ok) throw new Error(result.message);
    setCatalog(result.data);
  }
  useEffect(()=>{if(open) void load().catch(error=>setError(error.message));},[open,conversationId]);
  async function mutate(action:string,id:string){
    if(busy)return;
    if(action==="delete"&&!confirm("Excluir esta etiqueta de todas as conversas? Para remover apenas desta conversa, use Desvincular."))return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/envio-em-massa/etiquetas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({conversationId,action,id,...(action==="save"?{label,color}:{})})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.message);
      await Promise.all([load(),onChange()]);
      if(action==="save"||editing===id){setEditing(null);setLabel("");}
    }catch(error){setError(error instanceof Error?error.message:"Falha ao atualizar etiquetas.");}
    finally{setBusy(false);}
  }
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><Button variant="outline" size="sm" className="h-9 rounded-xl text-xs"><Tag className="h-4 w-4"/>Etiqueta{tags.length? ` (${tags.length})`:""}</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/>
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl">
        <Dialog.Title className="text-lg font-semibold">Etiquetas</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-muted-foreground">Organize a conversa com etiquetas e cores personalizadas.</Dialog.Description>
        <Dialog.Close asChild><Button aria-label="Fechar etiquetas" variant="ghost" size="icon" className="absolute right-3 top-3"><X className="h-4 w-4"/></Button></Dialog.Close>
        {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        <form className="my-5 space-y-3 rounded-xl border p-4" onSubmit={event=>{event.preventDefault();void mutate("save",editing||crypto.randomUUID());}}>
          <p className="text-sm font-semibold">{editing?"Editar etiqueta":"Criar etiqueta"}</p>
          <div className="flex gap-2"><Input aria-label="Nome da etiqueta" placeholder="Nome da etiqueta" maxLength={40} required value={label} onChange={event=>setLabel(event.target.value)}/><input aria-label="Cor da etiqueta" type="color" value={color} onChange={event=>setColor(event.target.value)} className="h-10 w-12 cursor-pointer rounded border bg-background"/></div>
          <div className="flex gap-2"><Button disabled={busy||!label.trim()} size="sm">{editing?"Salvar alterações":"Criar etiqueta"}</Button>{editing&&<Button size="sm" variant="ghost" type="button" onClick={()=>{setEditing(null);setLabel("");}}>Cancelar</Button>}</div>
        </form>
        <div className="space-y-2">{catalog.map(tag=><div key={tag.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{backgroundColor:tag.color}}/><span className="min-w-0 flex-1 break-words text-sm font-medium">{tag.label}</span>
          <Button disabled={busy} variant="outline" size="sm" onClick={()=>void mutate(tags.some(item=>item.id===tag.id)?"unlink":"link",tag.id)}>{tags.some(item=>item.id===tag.id)?"Desvincular":"Vincular"}</Button>
          <Button disabled={busy} variant="ghost" size="icon" aria-label={`Editar ${tag.label}`} onClick={()=>{setEditing(tag.id);setLabel(tag.label);setColor(tag.color);}}><Pencil className="h-4 w-4"/></Button>
          <Button disabled={busy} variant="ghost" size="icon" aria-label={`Excluir ${tag.label}`} onClick={()=>void mutate("delete",tag.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
        </div>)}{!catalog.length&&<p className="text-sm text-muted-foreground">Crie sua primeira etiqueta acima.</p>}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
