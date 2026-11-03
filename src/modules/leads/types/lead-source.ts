export function leadSourceLabel(source: string) {
  if (source === "chatbot:giga") return "VIVO FIBRA";
  if (source === "chatbot:click") return "NIO FIBRA";
  if (source === "chatbot") return "Lily / WhatsApp";
  if (source === "manual") return "Cadastro manual";
  return source || "Sem origem";
}
