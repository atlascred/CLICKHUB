/** Friendly names only; Evolution IDs remain stable for webhooks and isolation. */
export function whatsappAgentLabel(instanceName: string | null | undefined) {
  if (instanceName === "CLICK") return "NIO FIBRA";
  if (instanceName === "GIGA CLICK") return "VIVO FIBRA";
  return instanceName || "WhatsApp não vinculado";
}
