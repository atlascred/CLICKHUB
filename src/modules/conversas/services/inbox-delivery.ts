import { InboxService } from "./inbox.service";
import type { LeadAccessUser } from "@/lib/lead-source-access";
import { POST as sendWhatsApp } from "@/app/api/whatsapp/send/route";

/** Use the existing, instance-scoped sender for all manual inbox messages. */
export async function deliverInboxMessage(request: Request, user: LeadAccessUser, conversationId: string, payload: Record<string, unknown>) {
  const service = new InboxService();
  const detail = await service.getDetail(conversationId, user);
  if (!detail) throw new Error("Conversa não encontrada.");
  if (!detail.agent) throw new Error("Conversa sem agente. Selecione uma instância válida.");
  const response = await sendWhatsApp(new Request(new URL("/api/whatsapp/send", request.url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, conversationId: detail.id, to: detail.phone, agentId: detail.agent.id }),
  }));
  const result = await response.json();
  if (!response.ok || result.status !== "success") throw new Error(result.message || "Falha no envio da mensagem.");
  return service.getDetail(conversationId, user);
}
