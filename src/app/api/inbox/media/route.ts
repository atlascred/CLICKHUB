import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { deliverInboxMessage } from "@/modules/conversas/services/inbox-delivery";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(); assertPermission(user, permissions.conversationsView);
    const data = await request.formData(); const file = data.get("file");
    if (!(file instanceof File)) return NextResponse.json(errorResponse("Arquivo não enviado."), { status: 422 });
    if (!file.size) return NextResponse.json(errorResponse("O arquivo está vazio."), { status: 422 });
    if (file.size > 3 * 1024 * 1024) return NextResponse.json(errorResponse("Use um arquivo de até 3 MB."), { status: 422 });
    const media = `data:${file.type || "application/octet-stream"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
    const kind = file.type.startsWith("image/") ? "imagem" : file.type.startsWith("video/") ? "video" : "documento";
    const payload = { message: String(data.get("caption") ?? ""), fileName: file.name, mimeType: file.type,
      ...(file.type.startsWith("audio/") ? { audio: media } : { media, kind }) };
    const detail = await deliverInboxMessage(request, user, String(data.get("conversationId") ?? ""), payload);
    return NextResponse.json(successResponse("Arquivo enviado.", detail));
  } catch (error) { return authErrorResponse(error) ?? NextResponse.json(errorResponse(error instanceof Error ? error.message : "Falha no envio."), { status: 500 }); }
}
