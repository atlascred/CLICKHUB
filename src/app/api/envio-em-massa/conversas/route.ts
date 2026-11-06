import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireDispatchUser } from "@/modules/envio-em-massa/lib/dispatch-auth";
import { dispatchScope, recordObject, serviceWindowOpen } from "@/modules/envio-em-massa/lib/dispatch-policy";
import { dispatchConversations } from "@/modules/envio-em-massa/services/dispatch-conversations.service";
import { setDispatchBotPaused } from "@/modules/envio-em-massa/services/dispatch-bot-control";
export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = z.string().uuid();
function failure(error: unknown) { return authErrorResponse(error) ?? NextResponse.json(errorResponse(error instanceof Error ? error.message : "Falha na conversa oficial."), { status: 422 }); }
export async function GET(request: Request) {
  try {
    const user = await requireDispatchUser(), params = new URL(request.url).searchParams;
    const id = params.get("id"), search = (params.get("search") || "").trim().slice(0,100), filter = params.get("filter");
    if (id && !uuid.safeParse(id).success) throw new Error("Conversa inválida.");
    const limit = Math.min(500, Math.max(20, Number(params.get("limit")) || 100));
    const where: Prisma.ChatConversationWhereInput = { ...dispatchScope(user), ...(id ? { id } : {}), ...(search ? { OR: [{ phone: { contains: search.replace(/[^\d]/g, "") || search } }, { memory: { path: ["name"], string_contains: search, mode: "insensitive" as const } }] } : {}), ...(filter === "blocked" ? { state: "DISPATCH_BLOCKED" } : filter === "open" ? { state: "DISPATCH_OPEN" } : {}) };
    const rows = await prisma.$queryRaw<Array<{ id: string; pending: bigint; lastInbound: Date | null }>>`
      SELECT c.id,
        (SELECT count(*) FROM "ChatMessage" m WHERE m."conversationId"=c.id AND m.direction='inbound'
          AND m."createdAt">COALESCE((SELECT MAX(o."createdAt") FROM "ChatMessage" o WHERE o."conversationId"=c.id AND o.direction='outbound'
            AND COALESCE(o."rawPayload"->>'state','') NOT IN ('failed','sending','uncertain')), '1970-01-01'::timestamp)) AS pending,
        (SELECT MAX(i."createdAt") FROM "ChatMessage" i WHERE i."conversationId"=c.id AND i.direction='inbound') AS "lastInbound"
      FROM "ChatConversation" c WHERE c."deletedAt" IS NULL AND c."agentId" IS NULL AND c.state LIKE 'DISPATCH_%'
        AND (${user.role === "ADMIN"} OR c."ownerUserId"=${user.id}::uuid)
    `;
    if (!id && ["unread","unanswered"].includes(filter || "")) where.id = { in: rows.filter(row=>Number(row.pending)>0).map(row=>row.id) };
    const [all, employees, tags, total] = await Promise.all([
      prisma.chatConversation.findMany({ where, take: id ? 1 : limit + 1, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, phone: true, state: true, memory: true, ownerUserId: true, updatedAt: true, owner: { select: { name: true } }, messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: id ? 100 : 1, select: { id: true, direction: true, body: true, createdAt: true, rawPayload: true } }, _count: { select: { messages: true } } } }),
      user.role === "ADMIN" ? prisma.user.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
      prisma.appSetting.findMany({ where: { key: { startsWith: "chatbot:dispatch-tag:" } }, select: { value: true } }),
      prisma.chatConversation.count({ where }),
    ]);
    if (id && !all.length) return NextResponse.json(errorResponse("Conversa não encontrada."), { status: 404 });
    const summary = new Map(rows.map(r => [r.id, r]));
    const conversations = all.map(item => {
      const memory = recordObject(item.memory), stats = summary.get(item.id);
      return { id: item.id, phone: item.phone, botPaused: memory.dispatchBotPaused === true || recordObject(memory.nioBotMemory).humanTakeover === true, botState: String(memory.nioBotState || "START"), operator: "NIO FIBRA", state: item.state === "DISPATCH_BLOCKED" ? "BLOCKED" : item.state === "DISPATCH_CLOSED" ? "FINISHED" : "START", ownerUserId: item.ownerUserId, owner: item.owner, lead: { name: String(memory.name || item.phone) }, tags: tags.map(t=>recordObject(t.value)).filter(t=>Array.isArray(memory.dispatchTagIds)&&memory.dispatchTagIds.includes(t.id)).map(t=>({id:t.id,label:t.label,color:t.color})), pendingReplyCount: Number(stats?.pending || 0), freeFormWindowOpen: serviceWindowOpen(stats?.lastInbound), lastInboundAt: stats?.lastInbound?.toISOString() || null, messageCount: item._count.messages, messages: item.messages.map(({rawPayload,...message})=>({...message,trustedMedia:Boolean(recordObject(rawPayload).mediaId),deliveryStatus:recordObject(rawPayload).state || null})) };
    }).filter(item => !["unread","unanswered"].includes(filter || "") || item.pendingReplyCount > 0);
    return NextResponse.json(successResponse("Conversas de disparo consultadas.", { conversations: conversations.slice(0,id?1:limit), total, limit, hasMore: !id && total > limit, employees }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const user = await requireDispatchUser();
    const data = z.object({ conversationId: uuid, action: z.enum(["assign","block","unblock","close","reopen","pauseBot","resumeBot"]).default("assign"), ownerUserId: uuid.nullable().optional() }).parse(await request.json());
    if (data.action === "assign" && user.role !== "ADMIN") throw new Error("FORBIDDEN");
    if (data.action === "assign" && data.ownerUserId && !await prisma.user.findFirst({ where: { id: data.ownerUserId, status: "ACTIVE", deletedAt: null }, select:{id:true} })) throw new Error("Responsável indisponível.");
    if (data.action === "pauseBot" || data.action === "resumeBot") {
      if (!await prisma.chatConversation.findFirst({ where: { ...dispatchScope(user), id: data.conversationId }, select: { id: true } })) return NextResponse.json(errorResponse("Conversa não encontrada."), { status: 404 });
      await setDispatchBotPaused(prisma, data.conversationId, data.action === "pauseBot");
      return NextResponse.json(successResponse("Controle do chatbot atualizado.", null));
    }
    const result = await prisma.chatConversation.updateMany({ where: { ...dispatchScope(user), id: data.conversationId }, data: data.action === "assign" ? { ownerUserId: data.ownerUserId ?? null } : { state: data.action === "block" ? "DISPATCH_BLOCKED" : data.action === "close" ? "DISPATCH_CLOSED" : "DISPATCH_OPEN" } });
    if (!result.count) return NextResponse.json(errorResponse("Conversa não encontrada."),{status:404});
    return NextResponse.json(successResponse("Conversa atualizada.",null));
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const user = await requireDispatchUser(), id = uuid.parse(new URL(request.url).searchParams.get("id"));
    const result = await prisma.chatConversation.updateMany({ where: { ...dispatchScope(user), id }, data: { deletedAt: new Date() } });
    if (!result.count) return NextResponse.json(errorResponse("Conversa não encontrada."),{status:404});
    return NextResponse.json(successResponse("Conversa excluída.",null));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireDispatchUser();
    let conversationId: string, requestId: string, content: string, file: File | undefined;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData(); conversationId = uuid.parse(form.get("conversationId")); requestId = uuid.parse(form.get("requestId")); content = String(form.get("caption") || "").trim().slice(0,1024);
      const upload = form.get("file"); if (!(upload instanceof File) || !upload.size || upload.size > 3 * 1024 * 1024) throw new Error("Anexe um arquivo de até 3 MB.");
      const allowed = ["image/jpeg","image/png","image/webp","video/mp4","video/3gpp","audio/mpeg","audio/ogg","audio/mp4","audio/aac","audio/amr","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation","text/plain","text/csv"];
      if (!allowed.includes(upload.type.split(';')[0])) throw new Error("Formato não compatível com a Meta. Para áudio, use MP3, OGG, M4A ou AAC.");
      file = upload;
    } else {
      const data = z.object({ conversationId: uuid, requestId: uuid, content: z.string().trim().min(1).max(4096) }).parse(await request.json()); conversationId = data.conversationId; requestId = data.requestId; content = data.content;
    }
    if (!await prisma.chatConversation.findFirst({ where: { ...dispatchScope(user), id: conversationId },select:{id:true} })) return NextResponse.json(errorResponse("Conversa não encontrada."),{status:404});
    await setDispatchBotPaused(prisma, conversationId, true);
    const id = await dispatchConversations.send({ threadId: conversationId, requestId, body: content, file });
    return NextResponse.json(successResponse("Mensagem aceita pela Meta.",{messageId:id}));
  } catch (error) { return failure(error); }
}
