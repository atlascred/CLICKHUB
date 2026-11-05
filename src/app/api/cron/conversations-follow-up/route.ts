import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { FollowUpService } from "@/modules/chatbot/services/follow-up.service";
import { errorResponse, successResponse } from "@/lib/api-response";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json(errorResponse("Agendador não configurado."), { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json(errorResponse("Não autorizado.", "UNAUTHORIZED"), { status: 401 });
  }
  try {
    const result = await new FollowUpService().process(new URL(request.url).searchParams.get("dryRun") === "1");
    return NextResponse.json(successResponse("Follow-ups processados.", result), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json(errorResponse("Não foi possível processar os follow-ups."), { status: 500 }); }
}
export const POST = GET;
