export function leadSourceLabel(source: string) {
  if (source === "chatbot:giga") return "GIGA CLICK";
  if (source === "chatbot:click") return "CLICK";
  if (source === "chatbot") return "Lily / WhatsApp";
  if (source === "manual") return "Cadastro manual";
  return source || "Sem origem";
}
