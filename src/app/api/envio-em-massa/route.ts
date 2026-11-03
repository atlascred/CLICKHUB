import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { resolveLeadAgentScope } from "@/lib/lead-source-access";
import { resolveSelectedAgent } from "@/services/whatsapp-agent";
import { MassMessageService } from "@/modules/envio-em-massa/services/mass-message.service";
import { POST as sendWhatsApp } from "@/app/api/whatsapp/send/route";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request: Request) {
  try {
    const user=await requireCurrentUser(); assertPermission(user,permissions.agentsEdit); assertPermission(user,permissions.conversationsView);
    const data=await request.formData();
    const agent=await resolveSelectedAgent(String(data.get("agentId")??"")||undefined);
    const scope=resolveLeadAgentScope(user);
    if(scope!=="both" && agent.zapiInstanceId!==(scope==="click"?"CLICK":"GIGA CLICK")) throw new Error("FORBIDDEN");
    const file=data.get("file");
    if(file instanceof File && file.size>3*1024*1024) return NextResponse.json(errorResponse("Use um arquivo de até 3 MB."),{status:422});
    const media=file instanceof File?{fileName:file.name,mimeType:file.type||"application/octet-stream",dataUrl:`data:${file.type||"application/octet-stream"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`}:undefined;
    const service=new MassMessageService(async(phone,payload)=>{
      const response=await sendWhatsApp(new Request(new URL("/api/whatsapp/send",request.url),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,to:phone,agentId:agent.id})}));
      const result=await response.json(); if(!response.ok||result.status!=="success") throw new Error(result.message||"Falha ao enviar.");
    });
    const result=await service.send({contactsText:String(data.get("contacts")??""),message:String(data.get("message")??""),caption:String(data.get("caption")??""),media});
    return NextResponse.json(successResponse("Disparo concluído.",result));
  } catch(error){return authErrorResponse(error)??NextResponse.json(errorResponse(error instanceof Error?error.message:"Falha no envio em massa."),{status:500});}
}
