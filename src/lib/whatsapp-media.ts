export type MediaKind = "imagem" | "audio" | "video" | "documento";
export type MessageAttachment = { kind: MediaKind; mimeType: string; fileName: string; url: string };
export const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (...values: unknown[]) => values.find(value=>typeof value === "string" && value.trim()) as string | undefined;

export function unwrapMediaMessage(value: unknown) {
  let message = record(value);
  for (let i=0;i<8;i++) {
    const wrapped = ["ephemeralMessage","viewOnceMessage","viewOnceMessageV2","viewOnceMessageV2Extension","documentWithCaptionMessage","editedMessage"]
      .map(key=>record(record(message[key]).message)).find(item=>Object.keys(item).length);
    if (!wrapped) break;
    message=wrapped;
  }
  return message;
}

export function mediaEnvelope(value: unknown): (Record<string, unknown> & {message: Record<string, unknown>}) | null {
  const payload=record(value), raw=Object.keys(record(payload.raw)).length ? record(payload.raw) : payload;
  const data=Object.keys(record(raw.data)).length ? record(raw.data) : raw;
  const result=record(payload.result);
  const envelope=Object.keys(record(data.message)).length ? data : Object.keys(record(result.message)).length ? result : null;
  return envelope ? { ...envelope, message: unwrapMediaMessage(envelope.message) } : null;
}

export function describeMedia(value: unknown): { kind:MediaKind;mimeType:string;fileName:string;source?:string;encrypted:boolean } | null {
  const payload=record(value), media=record(payload.media), raw=record(payload.raw);
  const data=Object.keys(record(raw.data)).length ? record(raw.data) : raw;
  const envelope=mediaEnvelope(value), message=unwrapMediaMessage(envelope?.message);
  const pairs: Array<[string,MediaKind]> = [["imageMessage","imagem"],["stickerMessage","imagem"],["audioMessage","audio"],["videoMessage","video"],["ptvMessage","video"],["documentMessage","documento"]];
  const found=pairs.find(([key])=>Object.keys(record(message[key])).length);
  const content=record(found ? message[found[0]] : null);
  const mime=text(media.mimeType,payload.mimeType,content.mimetype,content.mimeType,data.mimetype,data.mimeType) || "";
  const type=String(payload.kind || media.kind || data.messageType || "").toLowerCase();
  const kind=found?.[1] || (/audio|ptt|voice/.test(type+mime)?"audio":/image|imagem/.test(type+mime)?"imagem":/video/.test(type+mime)?"video":/document|pdf|application\//.test(type+mime)?"documento":null);
  if(!kind)return null;
  const candidates=[media,payload,data,content,message];
  // Evolution's envelope.source is a device label (android/ios/web), never media bytes.
  // Older stored payloads may also have that label copied into mediaUrl.
  const actualSource = (value: unknown) => typeof value === "string" && !/^(android|ios|web|desktop|unknown)$/i.test(value.trim()) ? value : undefined;
  const explicit=text(actualSource(media.source),actualSource(payload.mediaUrl));
  const inline=text(...candidates.flatMap(item=>[item.base64,typeof item.data==='string'?item.data:undefined]),explicit && /^data:/.test(explicit)?explicit:undefined,explicit && /^[A-Za-z0-9+/=\s]+$/.test(explicit)?explicit:undefined);
  const source=inline || text(actualSource(media.source), ...candidates.flatMap(item=>[actualSource(item.mediaUrl),item.url,item.imageUrl,item.audioUrl,item.videoUrl,item.documentUrl]));
  const mimeType=mime || (kind==='audio'?'audio/ogg':kind==='imagem'?'image/jpeg':kind==='video'?'video/mp4':'application/octet-stream');
  const extension=mimeType.includes('pdf')?'pdf':mimeType.includes('webm')?'webm':mimeType.includes('png')?'png':mimeType.includes('mpeg')?'mp3':kind==='audio'?'ogg':kind==='imagem'?'jpg':kind==='video'?'mp4':'bin';
  const fileName=text(media.fileName,payload.fileName,content.fileName,content.filename,data.fileName) || `${kind}.${extension}`;
  return {kind,mimeType,fileName,source,encrypted:!inline && Boolean(content.mediaKey || content.directPath || source && /\.enc(?:\?|$)/i.test(source))};
}

export function attachmentForMessage(id: string, payload: unknown): MessageAttachment | null {
  const media=describeMedia(payload);
  return media ? {kind:media.kind,mimeType:media.mimeType,fileName:media.fileName,url:`/api/conversations/messages/${encodeURIComponent(id)}/media`} : null;
}

export function decodeMediaBase64(source: string): {bytes:Buffer;mimeType?:string} | null {
  const match=source.match(/^data:([^,]+);base64,([\s\S]+)$/i);
  if(/^data:/i.test(source)&&!match)return null;
  const value=(match?.[2]||source).replace(/\s/g,'');
  if(!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length%4===1)return null;
  if(value.length>36*1024*1024)throw new Error('Arquivo recebido excede o limite de visualização de 25 MB.');
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length)return null;
  return {bytes,mimeType:match?.[1]};
}
