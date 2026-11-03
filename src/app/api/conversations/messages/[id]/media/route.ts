import { withEvolutionInstance } from "@/services/evolution-context";
import { NextResponse } from "next/server";
import { permissions } from "@/constants/permissions";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/permissions";
import { downloadMetaMediaBytes } from "@/services/meta-whatsapp";
import { downloadEvolutionMedia } from "@/services/evolution-media";
import { describeMedia, record } from "@/lib/whatsapp-media";
import { mediaResponse } from "@/lib/media-response";
import { buildConversationAccessWhere } from "@/repositories/inbox.repository";

export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user=await requireCurrentUser();assertPermission(user,permissions.conversationsView);
    const {id}=await context.params;
    const message=await prisma.chatMessage.findFirst({where:{id,conversation:buildConversationAccessWhere(user)},select:{rawPayload:true,conversation:{select:{agent:{select:{zapiInstanceId:true}}}}}});
    if(!message)return NextResponse.json(errorResponse("Anexo não encontrado.","NOT_FOUND"),{status:404});
    const payload=record(message.rawPayload),media=describeMedia(payload);
    if(!media)return NextResponse.json(errorResponse("Mensagem sem anexo.","NOT_FOUND"),{status:404});
    if(payload.provider==='meta'&&typeof payload.mediaId==='string'){
      const downloaded=await downloadMetaMediaBytes(payload.mediaId);
      return mediaResponse(request,new Uint8Array(downloaded.bytes),downloaded.mimeType||media.mimeType,media.fileName);
    }
    const instance=message.conversation.agent?.zapiInstanceId;
    if(!instance)throw new Error("Conversa sem instância de origem identificada.");
    return await withEvolutionInstance(instance,async()=>{
      const downloaded=await downloadEvolutionMedia(payload);
      return mediaResponse(request,downloaded.bytes,downloaded.mimeType,downloaded.fileName);
    });
  }catch(error){return authErrorResponse(error)??NextResponse.json(errorResponse(error instanceof Error?error.message:"Não foi possível abrir o anexo.","MEDIA_DOWNLOAD_ERROR"),{status:502});}
}
