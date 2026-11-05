"use client";
import { useEffect, useState } from "react";
import type { MessageAttachment } from "@/lib/whatsapp-media";

export function ChatMessageMedia({ attachment }: { attachment: MessageAttachment }) {
  const [failed,setFailed]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [loading,setLoading]=useState(false);
  useEffect(()=>{setFailed(false);setLoading(false);},[attachment.url]);
  return <div className="mb-2 min-w-0 max-w-full space-y-2" data-attachment-kind={attachment.kind}>
    {!failed && attachment.kind==='imagem' ? <a href={attachment.url} target="_blank" rel="noreferrer"><img className="max-h-80 max-w-full rounded-md object-contain" src={attachment.url} alt={attachment.fileName} loading="lazy" onError={()=>setFailed(true)} /></a> : null}
    {!failed && attachment.kind==='audio' ? <audio key={attempt} className="w-64 max-w-full" controls preload="none" src={attachment.url} onPlay={()=>setLoading(true)} onWaiting={()=>setLoading(true)} onCanPlay={()=>setLoading(false)} onPlaying={()=>setLoading(false)} onError={()=>{setLoading(false);setFailed(true);}} /> : null}
    {!failed && attachment.kind==='video' ? <video className="max-h-80 max-w-full rounded-md" controls preload="metadata" src={attachment.url} onError={()=>setFailed(true)} /> : null}
    {loading && !failed && attachment.kind==='audio' ? <p role="status" className="text-xs">Carregando áudio...</p> : null}
    {failed ? <div role="status" className="space-y-1 text-xs"><p>Não foi possível reproduzir este arquivo.</p><button type="button" className="font-medium underline" onClick={()=>{setAttempt(value=>value+1);setFailed(false);}}>Tentar novamente</button><p>Você também pode abrir ou baixar o arquivo.</p></div> : null}
    <div className="flex max-w-full flex-wrap items-center gap-3 text-xs">
      <a className="max-w-full break-all font-medium underline" href={attachment.url} target="_blank" rel="noreferrer">{attachment.kind==='documento'?'📄 ':''}{attachment.fileName}</a>
      <a className="underline" href={attachment.url} download={attachment.fileName}>Baixar</a>
    </div>
  </div>;
}
