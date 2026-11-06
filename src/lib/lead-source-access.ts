import type { Prisma, User } from "@prisma/client";

export type LeadAccessUser = Pick<User, "id" | "role"> & Partial<Pick<User, "permissions">>;
export type LeadAgentScope = "click" | "giga" | "both";
export function getLeadAgentScope(value: unknown): LeadAgentScope {
  const flags = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (flags["leads.onlyClick"] === true && flags["leads.onlyGiga"] !== true) return "click";
  if (flags["leads.onlyGiga"] === true && flags["leads.onlyClick"] !== true) return "giga";
  return "both";
}
export function resolveLeadAgentScope(user: LeadAccessUser | undefined, requested?: unknown): LeadAgentScope {
  const allowed = getLeadAgentScope(user?.permissions);
  if (user?.role !== "ADMIN" && allowed !== "both") return allowed;
  return requested === "click" || requested === "giga" ? requested : "both";
}
export function conversationAgentWhere(user?: LeadAccessUser, requestedScope?: unknown): Prisma.ChatConversationWhereInput {
  const scope = resolveLeadAgentScope(user, requestedScope);
  return scope === "both" ? {} : { agent: { zapiInstanceId: scope === "click" ? "CLICK" : "GIGA CLICK" } };
}
export function leadSourceWhere(user?: LeadAccessUser, requestedScope?: unknown): Prisma.LeadWhereInput {
  const scope = resolveLeadAgentScope(user, requestedScope);
  // Evolution leads use the actual agent binding; isolated official NIO leads
  // carry an explicit source so they remain visible under the NIO filter.
  return scope === "both" ? {} : { OR: [{ conversations: { some: conversationAgentWhere(user, scope) } }, { source: scope === "click" ? "chatbot:click" : "chatbot:giga" }] };
}
