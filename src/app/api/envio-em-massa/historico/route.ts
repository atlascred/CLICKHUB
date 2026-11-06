import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse } from "@/lib/api-errors";
import { successResponse } from "@/lib/api-response";
import { requireDispatchUser } from "@/modules/envio-em-massa/lib/dispatch-auth";
import type { Campaign } from "@/modules/envio-em-massa/services/mass-message.service";
export async function GET(request:Request){
 try{
  const user=await requireDispatchUser(),params=new URL(request.url).searchParams;
  const offset=Math.max(0,Math.min(100000,Number(params.get("offset"))||0));
  const where={key:{startsWith:"chatbot:meta-campaign:"},...(user.role!=="ADMIN"?{value:{path:["ownerId"],equals:user.id}}:{})};
  const [records,total]=await Promise.all([prisma.appSetting.findMany({where,orderBy:[{createdAt:"desc"},{id:"desc"}],skip:offset,take:20,select:{value:true}}),prisma.appSetting.count({where})]);
  const campaigns=records.map(row=>row.value as unknown as Campaign);
  return NextResponse.json(successResponse("Histórico consultado.",{campaigns,total,offset,hasMore:offset+campaigns.length<total}),{headers:{"Cache-Control":"no-store"}});
 }catch(error){return authErrorResponse(error)??NextResponse.json({status:"error",message:"Não foi possível consultar o histórico."},{status:500});}
}
