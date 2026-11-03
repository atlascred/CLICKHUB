import "server-only";
import { getEvolutionConfig } from "@/services/evolution";
import { decodeMediaBase64, describeMedia, mediaEnvelope, record } from "@/lib/whatsapp-media";

/** Called only inside the originating instance's AsyncLocalStorage context. */
export async function downloadEvolutionMedia(payload: unknown) {
  const media=describeMedia(payload);
  if(!media)throw new Error("Mensagem sem anexo.");
  if(media.source && !/^https?:/i.test(media.source) && !media.encrypted) {
    const decoded=decodeMediaBase64(media.source);
    if(decoded)return {...decoded,mimeType:decoded.mimeType||media.mimeType,fileName:media.fileName};
  }
  const config=getEvolutionConfig();
  const envelope=mediaEnvelope(payload);
  // WhatsApp CDN URLs contain encrypted bytes; a successful HTTP response is not a playable file.
  if(envelope) {
    const response=await fetch(`${config.baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(config.instanceName)}`,{
      method:'POST',headers:{'Content-Type':'application/json',apikey:config.apiKey},
      body:JSON.stringify({message:envelope,convertToMp4:false}),cache:'no-store',signal:AbortSignal.timeout(30_000),
    });
    const result=record(await response.json().catch(()=>null)),data=Object.keys(record(result.data)).length?record(result.data):result;
    if(response.ok && typeof data.base64==='string'){
      const decoded=decodeMediaBase64(data.base64);
      if(decoded)return {...decoded,mimeType:String(data.mimetype||data.mimeType||decoded.mimeType||media.mimeType),fileName:typeof data.fileName==='string'?data.fileName:media.fileName};
    }
    if(media.encrypted)throw new Error("A Evolution não conseguiu descriptografar o anexo. Tente novamente ou peça o reenvio do arquivo.");
  }
  if(media.source && /^https?:\/\//i.test(media.source)) {
    const response=await fetch(media.source,{
      headers:new URL(media.source).origin===new URL(config.baseUrl).origin?{apikey:config.apiKey}:{},
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20_000),
    });
    if(!response.ok)throw new Error("Não foi possível baixar o anexo.");
    if(Number(response.headers.get('content-length'))>25*1024*1024)throw new Error("Anexo maior que 25 MB.");
    const reader=response.body?.getReader();if(!reader)throw new Error("Anexo vazio.");
    const chunks:Uint8Array[]=[];let size=0;
    try { while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>25*1024*1024)throw new Error("Anexo maior que 25 MB.");chunks.push(item.value);} }
    finally {await reader.cancel().catch(()=>{});}
    return {bytes:Buffer.concat(chunks),mimeType:response.headers.get('content-type')||media.mimeType,fileName:media.fileName};
  }
  throw new Error("Arquivo indisponível na instância de origem.");
}
