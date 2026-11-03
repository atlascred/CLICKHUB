"use client";
import { useState } from "react";
import type { MessageAttachment } from "@/lib/whatsapp-media";

export function ChatMessageMedia({ attachment }: { attachment: MessageAttachment }) {
  const [failed,setFailed]=useState(false);
  return <div className="mb-2 min-w-0 max-w-full space-y-2" data-attachment-kind={attachment.kind}>
    {!failed && attachment.kind==='imagem' ? <a href={attachment.url} target="_blank" rel="noreferrer"><img className="max-h-80 max-w-full rounded-md object-contain" src={attachment.url} alt={attachment.fileName} loading="lazy" onError={()=>setFailed(true)} /></a> : null}
    {!failed && attachment.kind==='audio' ? <audio className="w-64 max-w-full" controls preload="none" src={attachment.url} onError={()=>setFailed(true)} /> : null}
    {!failed && attachment.kind==='video' ? <video className="max-h-80 max-w-full rounded-md" controls preload="metadata" src={attachment.url} onError={()=>setFailed(true)} /> : null}
    {failed ? <p role="status" className="text-xs">Não foi possível carregar a prévia. Tente abrir ou baixar o arquivo.</p> : null}
    <div className="flex max-w-full flex-wrap items-center gap-3 text-xs">
      <a className="max-w-full break-all font-medium underline" href={attachment.url} target="_blank" rel="noreferrer">{attachment.kind==='documento'?'📄 ':''}{attachment.fileName}</a>
      <a className="underline" href={attachment.url} download={attachment.fileName}>Baixar</a>
    </div>
  </div>;
}
