import { normalized } from "./knowledge";

export type ConversationInterpretation = {
  intent: "data" | "question" | "smalltalk" | "recommendation" | "handoff" | "unclear";
  tone: "neutral" | "frustrated" | "uncertain" | "friendly";
  reply: string;
  // Evidence copied literally from the current message, never inferred values.
  evidence: Record<string, string>;
};

export function safeInterpretation(value: unknown, message: string): ConversationInterpretation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!["data", "question", "smalltalk", "recommendation", "handoff", "unclear"].includes(String(v.intent))) return null;
  if (!["neutral", "frustrated", "uncertain", "friendly"].includes(String(v.tone))) return null;
  const evidence: Record<string, string> = {};
  if (v.evidence && typeof v.evidence === "object") {
    for (const [key, source] of Object.entries(v.evidence)) {
      if (typeof source === "string" && source.length <= 240 && message.includes(source)) evidence[key] = source;
    }
  }
  return { intent: v.intent as ConversationInterpretation["intent"], tone: v.tone as ConversationInterpretation["tone"],
    reply: typeof v.reply === "string" ? v.reply.slice(0, 1800) : "", evidence };
}

/** Free answers cannot introduce unverified commercial terms or claim backend actions. */
export function safeFreeReply(reply: string, question?: string) {
  const commercial = question === undefined || /plano|internet|fibra|chip|wifi|wi-fi|mensal|instala|pagar|pagamento|fatura|preco|preço|equipamento|roteador|contrat|oferta/i.test(question);
  if (commercial && /\d/.test(reply)) return "";
  if (!reply.trim() || /https?:|\bR\$|(?:R\$|reais|USD|boleto)|gratuit|gr[aá]tis|desconto|ilimitad|fidelidade|taxa|instala[çc]|mensalidade|aprovad|contrata[çc][aã]o|cadastro (conclu[ií]do|registrado)|plano de|globoplay|\bmega\b|\bgiga\b|\bchip\b|netflix|cortesia|brinde|benef[ií]cio|sem custo|sem cobran|isento|registrad|enviei|enviado|agendei|cpf|token|senha|apikey/i.test(reply)) return "";
  return reply;
}

export function isExplicitConfirmation(text: string) {
  if (text.includes("?")) return false;
  return /^(sim|s|confirmo|confirmado|correto|tudo certo|esta correto|ta certo|pode confirmar|pode registrar|isso mesmo|isso|ok|okay|blz|beleza)[.!\s]*$/.test(normalized(text));
}

export function isExplicitRefusal(text: string) {
  return /^(nao|n|negativo|nao quero|prefiro manter|manter o atual|vou manter|pode manter)[.!\s]*$/.test(normalized(text));
}

export function fullName(text: string) {
  const source = text.trim().replace(/^(?:me chamo|meu nome [eé]|eu sou|sou|nome\s*:)\s*/i, "")
    .split(/[,;\n]|\b(?:meu cep|cep|quero|plano|cpf|cnpj|nasci|data de nascimento|email|e-mail|numero)\b/i)[0].replace(/\s+\d[\d.\-/\s]{9,}$/, "").trim();
  if (!/^[\p{L}][\p{L}' -]+$/u.test(source)) return "";
  const words = source.split(/\s+/);
  if (words.length < 2 || words.length > 12 || /^(?:de|da|do|das|dos|e)$/i.test(words.at(-1)!)) return "";
  if (/\b(?:nome|errad[oa]|incorret[oa]|documento|recebido|audio|imagem|arquivo|anexo|transcrito|comprovante)\b/.test(normalized(source))) return "";
  if (/\b(kkk|eae|rsrs|quero|nao|sim|sei|tenho|preciso|obrigad|pode|instalar|custa|plano|bom|boa|entendi|pergunta|meu|estou|voce|porque|qual|isso|voltei|hoje)\b/.test(normalized(source))) return "";
  return source;
}

export function extractLabeledName(text: string) {
  const match = text.match(/(?:me chamo|meu nome [eé]|eu sou|\bnome\s*:)\s*([^\n;,]+)/i);
  return match ? fullName(match[1]) : "";
}

export function hasInjection(text: string) {
  return /ignore.*(instru|regra|prompt)|system prompt|developer message|finja.*(aprov|desconto)|revele.*(token|chave|senha)|mude.*preco.*zero/i.test(text);
}

export function isAutomaticReply(text: string) {
  const value = normalized(text);
  return /agradecemos (?:o|seu|seu primeiro) contato/.test(value) && /(?:horario|atendimento|retornaremos|whatsapp oficial|responda.{0,12}1)/.test(value)
    || /(?:nossos atendimentos|nosso atendimento).{0,35}(?:funciona|horario)/.test(value) && /(?:deixe sua mensagem|retornaremos)/.test(value)
    || /(?:nome da rua|endereco completo)/.test(value) && /(?:ver a disponibilidade|verificar a disponibilidade|consulto e lhe falo)/.test(value) && /(?:bairro)/.test(value) && /(?:cidade)/.test(value) && /(?:cep)/.test(value);
}
