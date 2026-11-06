import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authErrorResponse } from "@/lib/api-errors";
import { requireDispatchUser } from "@/modules/envio-em-massa/lib/dispatch-auth";
import { dispatchScope, recordObject } from "@/modules/envio-em-massa/lib/dispatch-policy";
import { downloadMetaMediaBytes } from "@/services/meta-whatsapp";
import { createMediaDownloadCache } from "@/lib/media-download-cache";
import { mediaResponse } from "@/lib/media-response";
const cache = createMediaDownloadCache();
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request: Request) {
  try {
    const user = await requireDispatchUser(), id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const message = await prisma.chatMessage.findFirst({ where: { id, conversation: dispatchScope(user) }, select: { rawPayload: true, body: true } });
    if (!message) return NextResponse.json({message:"Anexo não encontrado."},{status:404});
    const raw = recordObject(message.rawPayload); if (typeof raw.mediaId !== "string" || !/^\d+$/.test(raw.mediaId)) return NextResponse.json({message:"Mensagem sem anexo."},{status:404});
    let filename="anexo"; try { filename = JSON.parse(message.body).fileName || filename; } catch { /* Text has no filename. */ }
    const media = await cache(`meta-dispatch:${id}`,async()=>{ const downloaded = await downloadMetaMediaBytes(raw.mediaId); return { bytes:new Uint8Array(downloaded.bytes),mimeType:downloaded.mimeType,fileName:filename }; });
    return mediaResponse(request,new Uint8Array(media.bytes),media.mimeType,filename);
  } catch(error) { return authErrorResponse(error) ?? NextResponse.json({message:"Não foi possível abrir o anexo oficial."},{status:502}); }
}
