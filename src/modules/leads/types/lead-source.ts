export function leadSourceLabel(source: string) {
  if (source === "chatbot:giga") return "VIVO FIBRA";
  if (source === "chatbot:click") return "NIO FIBRA";
  if (source === "chatbot") return "Lily / WhatsApp";
  if (source === "manual") return "Cadastro manual";
  return source || "Sem origem";
}

export function leadOperatorLabels(lead: { source: string; operatorInstances?: string[] }) {
  const instances = new Set(lead.operatorInstances ?? []);
  if (!instances.size) {
    if (lead.source === "chatbot:click") instances.add("CLICK");
    if (lead.source === "chatbot:giga") instances.add("GIGA CLICK");
  }
  return [instances.has("CLICK") ? "NIO FIBRA" : null, instances.has("GIGA CLICK") ? "VIVO FIBRA" : null]
    .filter((label): label is string => Boolean(label));
}

export function leadOriginText(lead: { source: string; operatorInstances?: string[] }) {
  return leadOperatorLabels(lead).join(" / ") || leadSourceLabel(lead.source);
}
