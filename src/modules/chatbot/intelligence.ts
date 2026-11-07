import type { ConversationContext } from "./knowledge";
import { normalized } from "./knowledge";

export type ConversationInterpretation = {
  intent: "data" | "question" | "smalltalk" | "recommendation" | "handoff" | "unclear";
  tone: "neutral" | "frustrated" | "uncertain" | "friendly";
  reply: string;
  // Computed locally after rendering trusted facts, never accepted from model JSON.
  replyValidated?: boolean;
  // Evidence copied literally from the current message, never inferred values.
  evidence: Record<string, string>;
};

export function safeInterpretation(value: unknown, message: string, context?: ConversationContext): ConversationInterpretation | null {
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
  const segments = Array.isArray(v.segments) ? v.segments.slice(0, 12) as Array<Record<string, unknown>> : null;
  const requestedKeys = segments ? segments.filter(part => part?.kind === "fact").map(part => part.factKey) : Array.isArray(v.factKeys) ? v.factKeys : [];
  const factKeys = context ? [...new Set(requestedKeys.filter((key): key is string => typeof key === "string" && Object.hasOwn(context.facts, key)))].slice(0, 4) : [];
  const usefulKeys = factKeys.filter(key => !factKeys.some(other => other !== key && context!.facts[other].includes(context!.facts[key]) && (context!.facts[other].length > context!.facts[key].length || factKeys.indexOf(other) < factKeys.indexOf(key))));
  const renderedFactKeys = new Set<string>();
  const rawReply = segments ? segments.map(part => {
    if (part?.kind === "fact") {
      const key = String(part.factKey);
      if (!usefulKeys.includes(key) || renderedFactKeys.has(key)) return "";
      renderedFactKeys.add(key);
      return `{{fato:${key}}}`;
    }
    return part?.kind === "text" && typeof part.text === "string" ? cleanConversationText(part.text) : "";
  }).filter(Boolean).join(" ") : cleanConversationText(typeof v.reply === "string" ? v.reply.slice(0, 1800) : "");
  // A model may answer a question correctly but label it 'data'. A factual
  // explanation is conversational, never a bare customer-field submission.
  const intent = v.intent === "data" && (factKeys.length || (v.answerDomain === "general" && Boolean(rawReply))) ? "question" : v.intent as ConversationInterpretation["intent"];
  const trustedAnswer = context && ["question", "recommendation"].includes(String(intent)) ? usefulKeys.map(key => context.facts[key]).join("\n\n") : "";
  const candidateTopic = v.answerDomain !== "general" && typeof v.unconfirmedTopic === "string" ? v.unconfirmedTopic.trim().slice(0, 100) : "";
  const topicWords = normalized(candidateTopic).split(" ").filter(word => word && !["a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das", "com", "plano", "opcao"].includes(word));
  const selectedFacts = normalized(usefulKeys.map(key => context!.facts[key]).join(" "));
  const topicCovered = topicWords.length > 0 && usefulKeys.length > 0 && topicWords.every(word => selectedFacts.split(" ").includes(word));
  const topic = topicCovered ? "" : candidateTopic;
  const literalTopic = topic && normalized(topic) && normalized(message).includes(normalized(topic)) && !/[\d][\d.\-/ ]{7,}[\d]|https?:|@|token|senha|apikey/i.test(topic) ? topic : "essa informação";
  const reply = context && topic ? `Sobre ${literalTopic}: essa informação não está confirmada no catálogo da ${context.operator}.` : context ? renderConversationReply(rawReply, context) || trustedAnswer : rawReply;
  return { intent: topic ? "question" : intent, tone: v.tone as ConversationInterpretation["tone"],
    reply, ...(context ? { replyValidated: Boolean(reply) } : {}), evidence };
}

function cleanConversationText(text: string) {
  return text
    .replace(/[^.!?\n]*(?:pode|poderia|informe|envie|me diga|me fale|preciso|qual)[^.!?\n]*(?:cep|nome completo|cpf|e-mail|vencimento|data de nascimento)[^.!?\n]*[.!?]?/gi, "")
    .replace(/(?:posso|poderia) (?:te |lhe )?ajudar (?:com |em )?mais[^.!?\n]*[.!?]?/gi, "")
    .trim();
}

/** Free answers cannot introduce unverified commercial terms or claim backend actions. */
export function safeFreeReply(reply: string, question?: string) {
  const commercial = question === undefined || /plano|internet|fibra|chip|wifi|wi-fi|mensal|instala|pagar|pagamento|fatura|preco|preço|equipamento|roteador|contrat|oferta/i.test(question);
  if (commercial && /\d/.test(reply)) return "";
  if (!reply.trim() || /https?:|\bR\$|(?:R\$|reais|USD|boleto)|gratuit|gr[aá]tis|desconto|ilimitad|fidelidade|taxa|instala[çc]|mensalidade|aprovad|contrata[çc][aã]o|cadastro (conclu[ií]do|registrado)|plano de|globoplay|\bmega\b|\bgiga\b|\bchip\b|netflix|cortesia|brinde|benef[ií]cio|sem custo|sem cobran|isento|registrad|enviei|enviado|agendei|cpf|token|senha|apikey/i.test(reply)) return "";
  return reply;
}

/** Natural language is free; commercial promises are inserted from trusted facts. */
export function renderConversationReply(reply: string, context: ConversationContext) {
  let invalid = false;
  const fragments = reply.replace(/\{\{fato:([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    if (!Object.hasOwn(context.facts, key)) invalid = true;
    return "";
  });
  if (invalid || !reply.trim() || /\{\{|https?:|\S+@\S+|\d[\d.\-/ ]{7,}\d|token|senha|apikey|prompt do sistema/i.test(fragments)) return "";
  // No free-form prices, benefit promises or claims that backend actions occurred.
  if (/R\$|\breais\b|gratuit|gr[aá]tis|sem (?:taxa|custo|cobran|fidelidade)|n[aã]o (?:tem|h[aá]|existe|cobramos).{0,20}(?:taxa|ades[aã]o|cobran)|desconto|ilimitad|globoplay|netflix|disney|hbo|cortesia|brinde|\d+(?:[.,]\d+)?\s*(?:mega|giga|mbps|gb|meses|mensais)|(?:j[aá] (?:registrei|enviei|agendei|aprovei|transferi|encaminhei)|(?:cadastro|contrato|solicita[çc][aã]o).{0,30}(?:aprovad|confirmad|conclu[ií]d|registrad)|(?:instalamos (?:hoje|amanh[aã])|(?:instala[çc]|agend|prazo|ativa[çc]).{0,35}(?:\d|hoje|amanh[aã])))/i.test(fragments)) return "";
  if ((context.operator === "NIO FIBRA" && /\bvivo\b/i.test(fragments)) || (context.operator === "VIVO FIBRA" && /\bnio\b/i.test(fragments))) return "";
  return reply.replace(/\{\{fato:([a-zA-Z0-9_]+)\}\}/g, (_match, key) => context.facts[key]).trim().slice(0, 4000);
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
  if (/\b(kkk|eae|rsrs|quero|nao|sim|sei|tenho|preciso|obrigad|pode|instalar|custa|plano|bom|boa|entendi|pergunta|meu|estou|voce|porque|qual|isso|voltei|hoje|adesao|ativacao|taxa|cobranca|mensalidade|funciona|queria|gostaria|fibra|internet)\b/.test(normalized(source))) return "";
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
