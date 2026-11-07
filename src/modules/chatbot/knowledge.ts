/** Official commercial conditions. Plans and prices always come from the CRM. */
export const commercialKnowledge = {
  advancePayment: "Não existe pagamento antecipado.",
  installation: "A instalação é totalmente gratuita, sem taxa de instalação.",
  firstBill: "A primeira mensalidade é 30 dias após a data da instalação da internet.",
  deadline: "A instalação ocorre em até 1 dia útil após a aprovação da contratação, condicionada à disponibilidade técnica e à confirmação do agendamento.",
  approval: "Aprovação cadastral, disponibilidade técnica e instalação realizada são etapas diferentes. Registrar a solicitação não significa que ela foi aprovada.",
  wifi: "Wi-Fi 5 e Wi-Fi 6 são tecnologias do roteador. O Wi-Fi 6 pode oferecer melhor eficiência com vários aparelhos compatíveis. O desempenho depende dos aparelhos, da distância, de interferências e da rede. A velocidade nominal do plano não é garantida em todos os aparelhos por Wi-Fi.",
  wirelessRange: "O alcance sem fio depende da potência, das antenas, dos aparelhos, do padrão usado e dos obstáculos. Bluetooth e Wi-Fi podem usar a faixa de 2,4 GHz; uma frequência maior não garante mais alcance. Não existe um limite único de distância válido para todos os aparelhos Bluetooth.",
  mobile: "O 5G do chip é a rede móvel; não é a mesma coisa que Wi-Fi de 5 GHz. Seu uso depende da cobertura móvel e de um aparelho compatível. A franquia do chip é a cadastrada no plano.",
  customerData: "O nome completo da mãe é um dos dados coletados para a solicitação e análise do cadastro.",
  security: "Sou a assistente virtual da Click Hubnet. Os dados são usados para a solicitação e análise do cadastro. Você pode pedir atendimento humano. Não solicitamos senhas bancárias, códigos de verificação ou pagamento antecipado.",
};

export function normalized(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function officialAnswer(text: string): string | undefined {
  const t = normalized(text);
  if (/adiant|antecip|antes de instalar|pag(?:ar|a|o).*(?:alguma coisa )?antes|pix|deposito/.test(t)) return commercialKnowledge.advancePayment;
  if (/primeira (mensalidade|fatura|conta)|primeiro (pagamento|boleto)|comeco a pagar|comeca a pagar/.test(t)) return commercialKnowledge.firstBill;
  if (/(instal|instalac|estal).*(grat|gratis|taxa|custa|pagar|valor)|taxa de instal/.test(t)) return commercialKnowledge.installation;
  if (/(quando|prazo|tempo|dias|demora|hoje|amanha).*(instal)|instal.*(quando|prazo|tempo|dias|demora|hoje|amanha)/.test(t)) return commercialKnowledge.deadline;
  if (/aprovad|garantid|cobertura/.test(t)) return commercialKnowledge.approval;
  if (/wi fi|wifi|roteador|equipamento/.test(t)) return /\b5g\b|5 ghz|5ghz/.test(t) ? `${commercialKnowledge.wifi}\n\n${commercialKnowledge.mobile}` : commercialKnowledge.wifi;
  if (/\b5g\b|5 ghz|5ghz/.test(t)) return commercialKnowledge.mobile;
  if (/golpe|confian|confiav|confiar|segur|privacidade|robo|bot\b|inteligencia artificial|voce e ia/.test(t)) return commercialKnowledge.security;
  if (/fidelidade|multa|desconto|portabilidade|franquia extra|netflix|hbo/.test(t)) {
    return "Essa condição ou benefício não está confirmado no catálogo. Posso encaminhar para uma consultora, sem prometer uma condição que não esteja cadastrada.";
  }
}

export type ConversationContext = {
  operator: string;
  facts: Record<string, string>;
  selectedPlan?: string;
  collectedFields?: string[];
  nextQuestion?: string;
  additionalRules?: string;
};

/** Only this agent's catalog enters the model context. No cross-operator fallback. */
export function conversationContext(input: {
  instance?: string | null;
  plans: Array<{ id: string; name: string; speed: string; price: unknown; description?: string | null }>;
  selectedPlanId?: string;
}): ConversationContext {
  const operator = input.instance === "CLICK" ? "NIO FIBRA" : input.instance === "GIGA CLICK" ? "VIVO FIBRA" : "Click Hubnet";
  const facts: Record<string, string> = { ...commercialKnowledge, operator: `Este atendimento é da ${operator}.` };
  input.plans.forEach((plan, index) => {
    const key = `plan_${index + 1}`;
    const price = Number(plan.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    facts[key] = `${plan.name} — ${price}/mês. ${plan.description || plan.speed}`;
    facts[`${key}_price`] = `${price}/mês`;
    facts[`${key}_benefits`] = plan.description || plan.speed;
  });
  const selected = input.plans.findIndex(plan => plan.id === input.selectedPlanId);
  return { operator, facts, ...(selected >= 0 ? { selectedPlan: `plan_${selected + 1}` } : {}) };
}
