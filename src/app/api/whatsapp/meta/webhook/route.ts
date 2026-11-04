import { NextResponse } from "next/server";
import { isValidMetaWebhook, verifyMetaWebhookChallenge } from "@/services/meta-whatsapp";
import { campaignStore } from "@/modules/envio-em-massa/services/campaign-store";
import type { RecipientStatus } from "@/modules/envio-em-massa/services/mass-message.service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const challenge = verifyMetaWebhookChallenge(request);
  return challenge ? new NextResponse(challenge) : new NextResponse("Verificação inválida.", { status: 403 });
}
export async function POST(request: Request) {
  const raw = await request.text();
  if (!isValidMetaWebhook(request, raw)) return new NextResponse("Assinatura inválida.", { status: 401 });
  try {
    const payload = JSON.parse(raw);
    if (payload.object !== "whatsapp_business_account") return NextResponse.json({ ignored: true });
    for (const entry of payload.entry || []) {
      if (String(entry.id) !== process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID?.trim()) continue;
      for (const change of entry.changes || []) {
        const value = change.value;
        if (change.field !== "messages" || String(value?.metadata?.phone_number_id) !== process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim()) continue;
        for (const status of value.statuses || []) {
          const callback = status.biz_opaque_callback_data;
          if (typeof callback !== "string") continue;
          const [id, originalPhone] = callback.split(":");
          if (!/^[0-9a-f-]{36}$/i.test(id) || (originalPhone && !/^55\d{10,11}$/.test(originalPhone))) continue;
          const nextStatus = ({ sent: "accepted", delivered: "delivered", read: "read", failed: "failed" } as Record<string, RecipientStatus>)[status.status];
          if (!nextStatus || typeof status.id !== "string") continue;
          for (let attempt = 0; attempt < 5; attempt++) {
            const current = await campaignStore.get(id);
            if (!current || current.phoneNumberId !== String(value.metadata.phone_number_id)) break;
            const index = current.recipients.findIndex(r => (r.messageId === status.id || (!r.messageId && r.phone === (originalPhone || status.recipient_id))) && r.status !== "queued");
            if (index < 0) break;
            const next = structuredClone(current);
            const rank: Record<RecipientStatus, number> = { queued: 0, sending: 1, uncertain: 1, failed: 2, accepted: 3, delivered: 4, read: 5 };
            const recipient = next.recipients[index];
            if (recipient.status === "failed" && nextStatus === "accepted") break;
            if (nextStatus === "failed" && ["delivered", "read"].includes(recipient.status)) break;
            if (nextStatus !== "failed" && rank[nextStatus] <= rank[recipient.status]) break;
            recipient.status = nextStatus;
            recipient.messageId = status.id;
            recipient.detail = nextStatus === "failed" ? "Falha informada pela Meta." : nextStatus === "read" ? "Leitura confirmada pela Meta." : nextStatus === "delivered" ? "Entrega confirmada pela Meta." : "Enviada pela Meta; aguardando entrega.";
            if (await campaignStore.replace(current, next)) break;
            if (attempt === 4) throw new Error("Conflito ao salvar status.");
          }
        }
        // Official campaigns never enter the Evolution chatbot or its contact history.
      }
    }
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 }); }
}
