// Node-only module: async_hooks cannot be bundled into a browser client.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

type InstanceCredentials = { instanceName: string; apiUrl: string; apiKey: string; number: string };
const context = new AsyncLocalStorage<InstanceCredentials>();

/** Credentials are server-only; never select a different instance as a fallback. */
export function resolveEvolutionInstance(instanceName = process.env.EVOLUTION_INSTANCE?.trim() || "") : InstanceCredentials {
  // A malformed secondary configuration must not interrupt the primary agent.
  if (instanceName && instanceName === process.env.EVOLUTION_INSTANCE?.trim()) {
    const apiUrl = process.env.EVOLUTION_API_URL || "";
    const apiKey = process.env.EVOLUTION_INSTANCE_TOKEN || process.env.EVOLUTION_API_KEY || "";
    const number = process.env.EVOLUTION_DEFAULT_NUMBER || "";
    if (!apiUrl || !apiKey || !number) throw new Error("Instância principal não configurada.");
    return Object.freeze({ instanceName, apiUrl: apiUrl.replace(/\/+$/, ""), apiKey, number });
  }
  let entries: InstanceCredentials[] = [];
  if (process.env.EVOLUTION_INSTANCES_JSON?.trim()) {
    try { entries = JSON.parse(process.env.EVOLUTION_INSTANCES_JSON); }
    catch { throw new Error("Configuração das instâncias Evolution inválida."); }
    if (!Array.isArray(entries)) throw new Error("Configuração das instâncias Evolution inválida.");
  }
  const matches = entries.filter(x => x.instanceName === instanceName);
  if (matches.length > 1) throw new Error("Instância Evolution configurada em duplicidade.");
  const entry = matches[0] ?? (instanceName && instanceName === process.env.EVOLUTION_INSTANCE?.trim() ? {
    instanceName, apiUrl: process.env.EVOLUTION_API_URL || "",
    apiKey: process.env.EVOLUTION_INSTANCE_TOKEN || process.env.EVOLUTION_API_KEY || "",
    number: process.env.EVOLUTION_DEFAULT_NUMBER || "",
  } : undefined);
  if (!entry?.apiUrl || !entry.apiKey || !entry.number || !/^https?:\/\//.test(entry.apiUrl)) {
    throw new Error("Instância Evolution não configurada; envio impedido para evitar troca de agente.");
  }
  return Object.freeze({ ...entry, apiUrl: entry.apiUrl.replace(/\/+$/, "") });
}

export function currentEvolutionInstance() { return context.getStore() ?? resolveEvolutionInstance(); }
export function withEvolutionInstance<T>(instanceName: string, run: () => T): T {
  return context.run(resolveEvolutionInstance(instanceName), run);
}
export function scopedEvolutionId(instanceName: string, providerId: string) {
  return `evolution:${createHash("sha256").update(instanceName).digest("hex").slice(0, 16)}:${providerId}`;
}
export function webhookInstance(request: Request, payload: Record<string, unknown>) {
  const supplied = typeof payload.instance === "string" ? payload.instance : typeof payload.instanceName === "string" ? payload.instanceName : "";
  const parts = new URL(request.url).pathname.split("/");
  const marker = parts.indexOf("instances");
  const pinned = marker >= 0 ? decodeURIComponent(parts[marker + 1] || "") : "";
  if (pinned && supplied && pinned !== supplied) throw new Error("Instância do webhook não corresponde à URL.");
  const instance = pinned || supplied;
  if (!instance) throw new Error("Webhook sem identificação de instância.");
  resolveEvolutionInstance(instance);
  return instance;
}

export function configuredEvolutionInstanceNames() {
  const names = new Set<string>();
  if (process.env.EVOLUTION_INSTANCE?.trim()) names.add(process.env.EVOLUTION_INSTANCE.trim());
  try {
    const entries = JSON.parse(process.env.EVOLUTION_INSTANCES_JSON || "[]") as InstanceCredentials[];
    if (Array.isArray(entries)) for (const entry of entries) if (typeof entry.instanceName === "string") names.add(entry.instanceName);
  } catch { /* Keep the primary scheduler available if a secondary configuration is invalid. */ }
  return [...names];
}
