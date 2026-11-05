export const FOLLOW_UP_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const FOLLOW_UP_LIMIT = 3;
export const FOLLOW_UP_SETTINGS_KEY = "chatbot:followup:settings";
export const followUpPrompts: Record<string, string> = {
  ASK_CEP: "o CEP da instalação", ASK_STREET_NUMBER: "o número da residência",
  ASK_COMPLEMENT: "se há complemento no endereço (se não houver, responda Não)",
  ASK_ADDRESS_CONFIRM: "a confirmação do endereço", CHOOSE_PLAN: "qual plano você deseja escolher",
  RECOMMEND_PLAN: "se prefere o plano recomendado ou quer conhecer as outras opções",
  ASK_NAME: "o seu nome completo", ASK_DOCUMENT: "o seu CPF ou CNPJ",
  ASK_BIRTH_DATE: "a sua data de nascimento", ASK_EMAIL: "o seu e-mail",
  ASK_BILLING_DUE_DAY: "o vencimento escolhido: 5, 8, 10, 15, 20 ou 25",
  CONFIRM_DATA: "a confirmação dos dados (SIM ou NÃO)", CORRECTION: "qual informação deseja corrigir e o valor correto",
};
export type FollowUpSettings = { enabled: boolean; instances: string[]; activatedAt: string };
export type FollowUpMessage = { id: string; direction: string; body: string; createdAt: Date; rawPayload: unknown; providerId?: string | null };
export type FollowUpConversation = {
  id: string; phone: string; state: string; memory: unknown; ownerUserId: string | null; updatedAt: Date;
  deletedAt?: Date | null; agent: { id: string; active: boolean; deletedAt: Date | null; zapiInstanceId: string | null } | null;
  lead?: { status: string; deletedAt: Date | null } | null;
  messages: FollowUpMessage[];
};
export function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function pausesFollowUp(text: string) {
  const value = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /nao (?:quero|tenho interesse|vou contratar)|pare de|parar (?:de enviar|mensagens)|nao (?:me envie|mande)|remov[ae]|cancelar|vou pensar|mais tarde|depois|aguard[ae]|espere|me da um tempo|deixa pra la/.test(value);
}
export function nextFollowUp(conversation: FollowUpConversation, settings: FollowUpSettings, now: Date) {
  const memory = jsonObject(conversation.memory), agent = conversation.agent;
  if (!settings.enabled || !agent?.active || agent.deletedAt || !agent.zapiInstanceId || !settings.instances.includes(agent.zapiInstanceId)
    || conversation.lead?.deletedAt || ["WON", "LOST"].includes(conversation.lead?.status ?? "")
    || conversation.deletedAt || conversation.ownerUserId || !followUpPrompts[conversation.state]
    || memory.humanTakeover || memory.blocked || memory.followUpPaused || memory.salesPaused || memory.followUpClosedAt || memory.pendingBotReply) return null;
  const messages = [...conversation.messages].sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime());
  const inbound = messages.find(m => m.direction === "inbound");
  const anchor = messages.find(m => m.direction === "outbound" && jsonObject(m.rawPayload).followUp !== true);
  if (!inbound || !anchor || inbound.createdAt > anchor.createdAt || pausesFollowUp(inbound.body)) return null;
  const raw = jsonObject(anchor.rawPayload);
  if (!Array.isArray(raw.inReplyTo) && !anchor.providerId?.startsWith("reply-to:")) return null;
  // Never revive old contacts or treat manual phone/CRM messages as bot prompts.
  if (now.getTime() - anchor.createdAt.getTime() > 24 * 60 * 60 * 1000) return null;
  const reminders = messages.filter(m => jsonObject(m.rawPayload).followUp === true && jsonObject(m.rawPayload).followUpAnchor === anchor.id);
  const last = reminders[0];
  const stage = last ? Number(jsonObject(last.rawPayload).followUpStage) + 1 : 1;
  if (!Number.isInteger(stage) || stage < 1 || stage > FOLLOW_UP_LIMIT) return null;
  const activation = new Date(settings.activatedAt).getTime();
  if (!Number.isFinite(activation)) return null;
  const base = last?.createdAt.getTime() ?? Math.max(anchor.createdAt.getTime(), activation);
  if (now.getTime() - base < FOLLOW_UP_INTERVAL_MS) return null;
  const lead = stage === 1 ? "Olá, você está aí ainda? 🙂" : stage === 2 ? "Você ainda tem interesse em contratar nossos planos? 😊" : "Ainda não recebi sua resposta. Você gostaria de continuar a contratação? 🙂";
  return { anchorId: anchor.id, stage, instanceName: agent.zapiInstanceId,
    body: `${lead}\nPara continuarmos de onde paramos, preciso que você me informe: ${followUpPrompts[conversation.state]}.`,
    key: `chatbot:followup:${conversation.id}:${anchor.id}:${stage}` };
}
