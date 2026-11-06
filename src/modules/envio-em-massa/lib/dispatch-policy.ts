import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
export const DISPATCH_SOURCE = "meta-dispatch";
export type DispatchUser = { id: string; role: string };
export function dispatchScope(user?: DispatchUser): Prisma.ChatConversationWhereInput {
  return { deletedAt: null, agentId: null, state: { startsWith: "DISPATCH_" },
    memory: { path: ["source"], equals: DISPATCH_SOURCE }, ...(user && user.role !== "ADMIN" ? { ownerUserId: user.id } : {}) };
}
export function dispatchThreadId(phoneId: string, phone: string) {
  const hex = createHash("sha256").update(`meta-dispatch:${phoneId}:${phone}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function serviceWindowOpen(at: Date | string | null | undefined, now = Date.now()) {
  const timestamp = at ? new Date(at).getTime() : NaN;
  return Number.isFinite(timestamp) && timestamp <= now + 60_000 && timestamp > now - 86_400_000;
}
export function metaEventDate(value: unknown) {
  const timestamp = typeof value === "string" && /^\d+$/.test(value) ? Number(value) * 1000 : 0;
  return new Date(timestamp > 0 && timestamp <= Date.now() + 60_000 ? timestamp : 0);
}
export function recordObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function incomingContent(message: Record<string, any>) {
  if (message.type === "text") return String(message.text?.body || "").slice(0, 16000);
  if (message.type === "button") return String(message.button?.text || "Resposta ao modelo");
  if (message.type === "interactive") return String(message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "Resposta interativa");
  if (["image", "audio", "video", "document", "sticker"].includes(message.type)) return String(message[message.type]?.caption || `[${message.type === "audio" ? "Áudio" : message.type === "image" ? "Imagem" : message.type === "video" ? "Vídeo" : message.type === "sticker" ? "Figurinha" : "Documento"}]`);
  if (message.type === "location") return `Localização: ${message.location?.latitude}, ${message.location?.longitude}`;
  if (message.type === "reaction") return String(message.reaction?.emoji || "Reação removida");
  return "[Mensagem recebida no WhatsApp]";
}
