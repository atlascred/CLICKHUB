import "server-only";
import type { OfficialTemplate } from "../lib/templates";

const requiredKeys = ["META_WHATSAPP_ACCESS_TOKEN", "META_WHATSAPP_PHONE_NUMBER_ID", "META_WHATSAPP_BUSINESS_ACCOUNT_ID", "META_WHATSAPP_APP_SECRET", "META_WHATSAPP_VERIFY_TOKEN"] as const;
export function officialMetaReadiness() {
  const missing = requiredKeys.filter(key => !process.env[key]?.trim());
  return { configured: !missing.length, missing, displayNumber: process.env.META_WHATSAPP_DEFAULT_NUMBER?.trim() || "", webhookPath: "/api/whatsapp/meta/webhook" };
}
export class MetaRequestError extends Error {
  constructor(message: string, public readonly uncertain: boolean) { super(message); }
}
export class OfficialMetaClient {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private config() {
    if (!officialMetaReadiness().configured) throw new Error("Cadastre o número oficial e configure a conexão com a Meta antes de enviar.");
    const version = process.env.META_GRAPH_API_VERSION?.trim() || "v23.0";
    const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID!.trim();
    const accountId = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID!.trim();
    if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(phoneId) || !/^\d+$/.test(accountId)) throw new Error("Confira os identificadores e a versão da API da Meta.");
    return { base: `https://graph.facebook.com/${version}`, phoneId, accountId, token: process.env.META_WHATSAPP_ACCESS_TOKEN!.trim() };
  }
  private async request(path: string, payload?: unknown, timeoutMs = 20_000): Promise<any> {
    const config = this.config();
    let response: Response;
    try {
      response = await this.transport(`${config.base}/${path}`, { method: payload ? "POST" : "GET", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new MetaRequestError("Sem confirmação da Meta. Confira o resultado antes de tentar novamente.", Boolean(payload)); }
    let result: any;
    try { result = await response.json(); } catch { throw new MetaRequestError("A Meta retornou uma resposta inválida.", Boolean(payload)); }
    if (!response.ok) throw new MetaRequestError(`A Meta recusou a solicitação${Number.isInteger(result?.error?.code) ? ` (código ${result.error.code})` : ""}. Confira o número, as permissões e o modelo na Meta.`, response.status >= 500 && Boolean(payload));
    return result;
  }
  /** Best-effort native typing; overlaps reply preparation with a short timeout. */
  async typing(messageId: string) {
    if (!messageId || messageId.startsWith("meta:")) return false;
    try {
      const { phoneId } = this.config();
      await this.request(`${phoneId}/messages`, { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }, 2500);
      return true;
    } catch { return false; }
  }
  async templates(includePending = false) {
    const config = this.config();
    const templates: OfficialTemplate[] = [];
    let after = "";
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const result = await this.request(`${config.accountId}/message_templates?fields=id,name,language,status,parameter_format,components&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
      if (!Array.isArray(result?.data)) throw new Error("Não foi possível consultar os modelos na Meta.");
      templates.push(...result.data.filter((t: OfficialTemplate) => includePending || t.status === "APPROVED"));
      if (!result.paging?.next) return templates;
      after = result.paging?.cursors?.after;
      if (typeof after !== "string" || !after || seen.has(after)) break;
      seen.add(after);
    }
    throw new Error("Não foi possível carregar todos os modelos. Atualize a consulta.");
  }
  async sendContent(phone: string, content: Record<string, unknown>) {
    const config = this.config();
    const result = await this.request(`${config.phoneId}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: phone, ...content });
    const id = result?.messages?.[0]?.id;
    if (typeof id !== "string" || !id) throw new MetaRequestError("Envio sem identificação da Meta. Confira o histórico antes de reenviar.", true);
    return id;
  }
  async upload(file: File) {
    const config = this.config();
    const form = new FormData(); form.set("messaging_product", "whatsapp"); form.set("file", file, file.name);
    let response: Response;
    try { response = await this.transport(`${config.base}/${config.phoneId}/media`, { method: "POST", headers: { Authorization: `Bearer ${config.token}` }, body: form, signal: AbortSignal.timeout(20000) }); }
    catch { throw new MetaRequestError("Não foi possível carregar o arquivo para a Meta.", false); }
    const data = await response.json().catch(() => null);
    if (!response.ok || typeof data?.id !== "string") throw new MetaRequestError("A Meta recusou o arquivo. Confira o formato e o tamanho.", false);
    return data.id as string;
  }
  async send(phone: string, template: unknown, campaignId: string) {
    const config = this.config();
    const result = await this.request(`${config.phoneId}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: phone, type: "template", template, biz_opaque_callback_data: `${campaignId}:${phone}` });
    const id = result?.messages?.[0]?.id;
    if (typeof id !== "string" || !id) throw new MetaRequestError("Sem identificação da mensagem na Meta. Não reenvie sem conferir.", true);
    return id;
  }
}
