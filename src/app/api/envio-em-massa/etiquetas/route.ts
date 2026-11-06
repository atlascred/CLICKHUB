import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireDispatchUser } from "@/modules/envio-em-massa/lib/dispatch-auth";
import { authErrorResponse } from "@/lib/api-errors";
import { dispatchScope as dispatchConversationScope } from "@/modules/envio-em-massa/lib/dispatch-policy";


const schema = z.object({
  conversationId: z.string().uuid(),
  action: z.enum(["save", "delete", "link", "unlink"]),
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export async function GET(request: Request) {
  try {
    const user = await requireDispatchUser();
    const id = new URL(request.url).searchParams.get("conversationId");
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({message:"Conversa inválida."},{status:400});
    const conversation = await prisma.chatConversation.findFirst({where:{...dispatchConversationScope(user),id:id!},select:{id:true}});
    if (!conversation) return NextResponse.json({message:"Conversa não encontrada."},{status:404});
    const records = await prisma.appSetting.findMany({where:{key:{startsWith:"chatbot:dispatch-tag:"}}});
    return NextResponse.json({data:records.map(record=>record.value)},{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return authErrorResponse(error) ?? NextResponse.json({message:"Falha ao consultar etiquetas."},{status:500}); }
}
export async function POST(request: Request) {
  try {
    const user = await requireDispatchUser();
    const body = await request.json();
    const parsed = schema.safeParse(body && typeof body === "object"
      ? {...body, ...(body.action !== "save" ? {label:undefined,color:undefined} : {})}
      : body);
    if (!parsed.success) return NextResponse.json({message:"Confira o nome e a cor da etiqueta."},{status:400});
    const {conversationId,action,id,label,color}=parsed.data;
    const result = await prisma.$transaction(async tx=>{
      const conversation=await tx.chatConversation.findFirst({where:{...dispatchConversationScope(user),id:conversationId},select:{id:true}});
      if(!conversation) return 404;
      const key="chatbot:dispatch-tag:"+id;
      if(action==="save"){
        if(!label||!color) return 400;
        const record=await tx.appSetting.findUnique({where:{key}});
        const owner=(record?.value as {ownerUserId?:string}|undefined)?.ownerUserId;
        if(record && user.role!=="ADMIN" && owner!==user.id) return 403;
        const value={id,label,color,ownerUserId:owner||user.id};
        await tx.appSetting.upsert({where:{key},create:{key,value},update:{value}});
      } else if(action==="delete"){
        const record=await tx.appSetting.findUnique({where:{key}});
        if(!record) return 404;
        if(user.role!=="ADMIN" && (record.value as {ownerUserId?:string}).ownerUserId!==user.id) return 403;
        await tx.appSetting.delete({where:{key}});
        // References to removed labels are ignored when rendering conversations.
      } else {
        if(action==="link" && !await tx.appSetting.findUnique({where:{key}})) return 404;
        await tx.$executeRaw(Prisma.sql`
          UPDATE "ChatConversation"
          SET memory = jsonb_set(memory, '{dispatchTagIds}',
            COALESCE((SELECT jsonb_agg(value) FROM (
              SELECT DISTINCT value FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(memory->'dispatchTagIds')='array' THEN memory->'dispatchTagIds' ELSE '[]'::jsonb END
              ) WHERE value <> ${id}
              UNION SELECT ${id} WHERE ${action === "link"}
            ) tags), '[]'::jsonb)), "updatedAt"=NOW()
          WHERE id=${conversationId}::uuid
            AND (${user.role==="ADMIN"} OR "ownerUserId"=${user.id}::uuid)
        `);
      }
      return 200;
    });
    if(result!==200) return NextResponse.json({message:result===403?"Você pode editar ou excluir apenas etiquetas criadas por você.":"Etiqueta ou conversa inválida."},{status:result});
    return NextResponse.json({ok:true});
  } catch(error){return authErrorResponse(error)??NextResponse.json({message:"Não foi possível salvar a etiqueta."},{status:500});}
}
