import { dispatchConversations } from "@/modules/envio-em-massa/services/dispatch-conversations.service";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-context";
import { assertPermission } from "@/lib/permissions";
import { permissions } from "@/constants/permissions";
import { campaignContacts, MassMessageService } from "@/modules/envio-em-massa/services/mass-message.service";
import { campaignStore } from "@/modules/envio-em-massa/services/campaign-store";
import { officialMetaReadiness, OfficialMetaClient } from "@/modules/envio-em-massa/services/official-meta.service";
import { buildTemplatePayload } from "@/modules/envio-em-massa/lib/templates";
export const runtime = "nodejs";
export const maxDuration = 60;
const client = new OfficialMetaClient();
const service = new MassMessageService(campaignStore, async (phone, _template, id) => {
  const campaign = await campaignStore.get(id);
  if (!campaign) throw new Error("Campanha não encontrada.");
  return dispatchConversations.campaignRecipient(campaign, phone);
});
async function currentUser() {
  const user = await requireCurrentUser();
  assertPermission(user, permissions.agentsEdit);
  assertPermission(user, permissions.conversationsView);
  return user;
}
function validId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("Identificação da campanha inválida.");
}
function failure(error: unknown) {
  return authErrorResponse(error) ?? NextResponse.json(errorResponse(error instanceof Error ? error.message : "Falha na campanha oficial."), { status: 422 });
}
export async function GET(request: Request) {
  try {
    const user = await currentUser();
    const id = new URL(request.url).searchParams.get("id");
    if (id) { validId(id); return NextResponse.json(successResponse("Campanha consultada.", await service.read(id, user.id))); }
    const readiness = officialMetaReadiness();
    return NextResponse.json(successResponse("Conexão oficial consultada.", { ...readiness, templates: readiness.configured ? await client.templates(true) : [] }));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!officialMetaReadiness().configured) throw new Error("Cadastre o número oficial e configure a conexão com a Meta antes de enviar.");
    const body = await request.json();
    validId(body.id);
    if (body.action === "next") return NextResponse.json(successResponse("Campanha atualizada.", await service.next(body.id, user.id, process.env.META_WHATSAPP_PHONE_NUMBER_ID!.trim())));
    if (body.action !== "create" || body.consent !== true) throw new Error("Confirme que os contatos autorizaram o recebimento das mensagens.");
    if (body.agentId || body.file || body.media) throw new Error("Esta tela envia exclusivamente modelos aprovados pela API oficial da Meta.");
    const contacts = campaignContacts(body.contacts);
    const mode = body.mode === "text" ? "text" : "template";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (mode === "text" && (!message || message.length > 4096)) throw new Error("Informe uma mensagem com até 4096 caracteres.");
    const fingerprint = createHash("sha256").update(JSON.stringify({ contacts, mode, message, templateId: body.templateId, values: body.values, mediaUrl: body.mediaUrl, isTest: Boolean(body.isTest) })).digest("hex");
    const existing = await campaignStore.get(body.id);
    if (existing) {
      if (existing.ownerId !== user.id || existing.fingerprint !== fingerprint) throw new Error("Identificação já usada em outra campanha.");
      return NextResponse.json(successResponse("Campanha já registrada.", existing));
    }
    let template: unknown = {}, messageBody = message, title = "Mensagem de texto";
    if (mode === "text") await dispatchConversations.assertTextRecipients(contacts, user);
    else {
      const templates = await client.templates();
      const selected = templates.find(t => t.id === body.templateId);
      if (!selected) throw new Error("O modelo ainda não está aprovado ou não pertence à conta oficial conectada.");
      template = buildTemplatePayload(selected, body.values || {}, body.mediaUrl);
      title = selected.name;
      messageBody = selected.components.filter(component=>component.text).map(component=>(component.text || "").replace(/\{\{\s*(\w+)\s*\}\}/g,(_match,name)=>String(body.values?.[`${component.type}:${name}`] || ""))).join("\n\n");
    }
    if (body.isTest && contacts.length !== 1) throw new Error("O teste individual aceita um único destinatário.");
    await campaignStore.create({ id: body.id, ownerId: user.id, ownerName: user.name, phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID!.trim(), fingerprint, createdAt: new Date().toISOString(), template, mode, title, messageBody, isTest: Boolean(body.isTest), recipients: contacts.map(phone => ({ phone, status: "queued" })) });
    const saved = await service.read(body.id, user.id);
    if (saved.fingerprint !== fingerprint) throw new Error("Identificação já usada em outra campanha.");
    return NextResponse.json(successResponse("Campanha oficial criada.", saved), { status: 201 });
  } catch (error) { return failure(error); }
}
