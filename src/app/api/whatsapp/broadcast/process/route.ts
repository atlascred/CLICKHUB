import { configuredEvolutionInstanceNames, withEvolutionInstance } from "@/services/evolution-context";
import { isMetaWhatsAppEnabled } from "@/services/meta-whatsapp";
import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { processDueBroadcasts } from "@/services/whatsapp-broadcast";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    const querySecret = new URL(request.url).searchParams.get("secret")?.trim();
    if (authHeader !== secret && querySecret !== secret) {
      return NextResponse.json(errorResponse("Cron nao autorizado.", "UNAUTHORIZED"), { status: 401 });
    }
  }

  const result = { processed: 0, failedInstances: 0 };
  if (isMetaWhatsAppEnabled()) result.processed = (await processDueBroadcasts(1)).processed;
  else for (const instance of configuredEvolutionInstanceNames()) {
    try {
      const current = await withEvolutionInstance(instance, () => processDueBroadcasts(1));
      result.processed += current.processed;
    } catch { result.failedInstances++; }
  }
  return NextResponse.json(successResponse("Disparos processados.", result));
}
