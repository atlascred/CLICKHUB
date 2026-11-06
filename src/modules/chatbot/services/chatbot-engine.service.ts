import { coverageDataset, coverageUnavailable } from "@/modules/chatbot/coverage-policy";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { CepRepository } from "@/repositories/cep.repository";
import { ChatbotRepository } from "@/repositories/chatbot.repository";
import { OpenAiService } from "@/services/openai/openai.service";
import type { ExtractedCustomerData } from "@/services/openai/openai.service";
import { checkEvolutionWhatsAppNumber, resolveEvolutionMessageId, sendEvolutionTextMessage } from "@/services/evolution";
import { currentEvolutionInstance, scopedEvolutionId } from "@/services/evolution-context";
import { checkMetaWhatsAppNumber, markMetaMessageAsRead, sendMetaTextMessage } from "@/services/meta-whatsapp";
import { ZapiService } from "@/services/zapi/zapi.service";
import { onlyDigits } from "@/utils/mask";
import { commercialKnowledge, officialAnswer } from "@/modules/chatbot/knowledge";
import { extractLabeledName, fullName, isAutomaticReply, hasInjection, isExplicitConfirmation, isExplicitRefusal, safeFreeReply, type ConversationInterpretation } from "@/modules/chatbot/intelligence";

const VALID_BILLING_DAYS = [5, 8, 10, 15, 20, 25];

export class ChatbotEngineService {
  constructor(
    private readonly cepRepository = new CepRepository(),
    private readonly chatbotRepository = new ChatbotRepository(),
    private readonly zapiService = new ZapiService(),
    private readonly openAiService = new OpenAiService(),
    private readonly delivery?: { send: (input: { phone: string; message: string }) => Promise<void> },
  ) {}

  async validateCoverage(cep: string, agent?: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>) {
    const dataset = coverageDataset(agent);
    const coverage = await this.cepRepository.findByCep(cep, dataset);
    if (coverage) return coverage;

    return {
      cep,
      available: !dataset,
      street: null,
      neighborhood: null,
      city: null,
      state: null,
    };
  }

  async handleIncomingCall(input: {
    phone: string;
    providerId?: string;
    rawPayload?: Prisma.InputJsonValue;
    instanceId?: string;
  }) {
    const phone = normalizeWhatsappPhone(input.phone);
    const agent = await this.chatbotRepository.getAgentByInstance(input.instanceId, false);
    const conversation = await this.chatbotRepository.findOrCreateConversation(phone, agent?.id);
    const eventId = input.providerId ? `call:${input.providerId}` : undefined;

    if (eventId) {
      const existing = await this.chatbotRepository.findMessageByProviderId(eventId);
      if (existing) return { state: conversation.state, replied: false, duplicated: true };
      const claimed = await this.chatbotRepository.claimInboundMessage({
        conversationId: conversation.id,
        body: "[Ligação recebida]",
        providerId: eventId,
        rawPayload: input.rawPayload ?? {},
      });
      if (!claimed) return { state: conversation.state, replied: false, duplicated: true };
    } else {
      await this.chatbotRepository.saveMessage({
        conversationId: conversation.id,
        direction: "inbound",
        body: "[Ligação recebida]",
        rawPayload: input.rawPayload ?? {},
      });
    }

    const memory = normalizeMemory(conversation.memory);
    if (conversation.state === "FINISHED" || memory.humanTakeover || memory.blocked || ["BLOCKED", "HUMAN_HANDOFF", "MANUAL"].includes(conversation.state)) return { state: conversation.state, replied: false, duplicated: false };
    const resumePrompt = callResumePrompt(conversation.state, memory, agent);
    const reply = `Não consigo atender ligações por aqui, mas continuo com você pelo WhatsApp. 😊\n\n${resumePrompt}`;
    await this.zapiService.sendText({ phone, message: reply, config: agentConfig(agent) });
    await this.chatbotRepository.saveMessage({
      conversationId: conversation.id,
      direction: "outbound",
      body: reply,
    });

    return { state: conversation.state, replied: true, duplicated: false };
  }

  async processIncomingMessage(input: {
    phone: string;
    message: string;
    providerId?: string;
    rawPayload?: Prisma.InputJsonValue;
    instanceId?: string;
    extractedData?: ExtractedCustomerData;
    provider?: "zapi" | "evolution" | "meta";
    batchMessages?: Array<{ providerId: string; body: string; rawPayload?: Prisma.InputJsonValue }>;
    resolvedAgent?: NonNullable<Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>>;
  }) {
    const phone = normalizeWhatsappPhone(input.phone);
    let alreadyReceived = false;

    if (input.providerId) {
      const [receipt, received] = await Promise.all([
        this.chatbotRepository.findReplyReceipt(input.providerId),
        this.chatbotRepository.findMessageByProviderId(input.providerId),
      ]);
      if (receipt) {
        await this.chatbotRepository.finalizePendingReply(input.providerId);
        return { state: "DUPLICATED", replied: false, delayMs: 0 };
      }
      alreadyReceived = Boolean(received);
    }

    const agent = input.resolvedAgent ?? await this.chatbotRepository.getAgentByInstance(input.instanceId, input.provider === "evolution");
    if (input.resolvedAgent && input.provider === "evolution" && input.resolvedAgent.zapiInstanceId !== input.instanceId) throw new Error("Agente da requisição não corresponde à instância.");
    const conversation = await this.chatbotRepository.findOrCreateConversation(phone, agent?.id);
    const currentMemory = normalizeMemory(conversation.memory);

    if (!alreadyReceived && input.providerId) {
      const claimed = await this.chatbotRepository.claimInboundMessage({
        conversationId: conversation.id,
        body: input.batchMessages?.[0]?.body ?? input.message,
        providerId: input.providerId,
        rawPayload: input.rawPayload ?? {},
      });
      if (!claimed) {
        return { state: "DUPLICATED", replied: false, delayMs: 0 };
      }
    } else if (!alreadyReceived) {
      await this.chatbotRepository.saveMessage({
        conversationId: conversation.id,
        direction: "inbound",
        body: input.message,
        rawPayload: input.rawPayload ?? {},
      });
    }

    for (const item of input.batchMessages ?? []) {
      if (item.providerId !== input.providerId) {
        await this.chatbotRepository.claimInboundMessage({ conversationId: conversation.id, providerId: item.providerId, body: item.body, rawPayload: item.rawPayload });
      }
    }
    if (conversation.state === "FINISHED") {
      return { state: "FINISHED", replied: false, delayMs: 0, finished: true };
    }
    if (currentMemory.humanTakeover === true || currentMemory.blocked === true || ["BLOCKED", "HUMAN_HANDOFF", "MANUAL"].includes(conversation.state)) {
      return { state: conversation.state, replied: false, delayMs: 0, humanTakeover: true };
    }

    if (isAutomaticReply(input.message)) {
      if (!currentMemory.pendingBotReply) await this.chatbotRepository.updateConversation({ id: conversation.id, state: conversation.state, memory: JSON.parse(JSON.stringify({ ...currentMemory, automationReplyDetected: true })) }, false);
      return { state: conversation.state, replied: false, delayMs: 0, automaticReply: true };
    }

    const provider = input.provider ?? "zapi";

    if (input.providerId && provider === "zapi") {
      await this.zapiService.markAsRead(input.providerId, phone, agentConfig(agent));
    }
    if (input.providerId && provider === "meta" && !this.delivery) {
      await markMetaMessageAsRead(input.providerId);
    }
    const pending = currentMemory.pendingBotReply;
    if (pending && pending.providerId !== input.providerId) throw new Error("Resposta pendente exige revisão antes de continuar.");
    if (pending?.sending) {
      await this.chatbotRepository.updateConversation({ id: conversation.id, state: conversation.state,
        memory: JSON.parse(JSON.stringify({ ...currentMemory, humanTakeover: true, takeoverReason: "Entrega incerta; conferir histórico antes de reenviar.", takeoverAt: new Date().toISOString() })) });
      throw new Error("Entrega incerta; revisão humana necessária antes de reenviar.");
    }
    let interpretation: ConversationInterpretation | null = null;
    if (!pending && needsConversationalInterpretation(input.message, conversation.state, currentMemory, agent?.plans ?? [])) {
      try {
        interpretation = await this.openAiService.interpretConversation({
          message: input.message, state: conversation.state,
          history: (conversation.messages ?? []).slice(0, 6).reverse().map(m => ({
            role: m.direction === "inbound" ? "user" : "assistant",
            text: m.body.replace(/\b\d[\d.\-/]{6,}\d\b/g, "[dado protegido]").replace(/\S+@\S+/g, "[e-mail]").slice(0, 400),
          })),
        });
      } catch { /* AI failure never blocks the deterministic flow. */ }
    }
    const next: NextBotResponse = pending?.next ?? await this.nextResponse({
      phone,
      message: input.message,
      state: conversation.state,
      memory: {
        ...currentMemory,
        whatsapp: phone,
      },
      agent,
      extractedData: input.extractedData,
      interpretation,
      parts: input.batchMessages?.map(m => m.body),
      requestId: input.providerId,
      instanceId: input.instanceId,
    });

    const minTyping = agent?.minTypingSeconds ?? 2;
    const maxTyping = agent?.maxTypingSeconds ?? 4;
    const delaySeconds = randomDelaySeconds(minTyping, maxTyping);
    const typingEnabled =
      (agent?.enableReplyDelay ?? true) && (agent?.enableTyping ?? true);

    // Durable response prepared before any external send. Uncertain sends require review.
    const prepared: PendingBotReply = { providerId: input.providerId, next, sending: false, batchIds: input.batchMessages?.map(m => m.providerId) };
    await this.chatbotRepository.updateConversation({
      id: conversation.id, state: conversation.state,
      memory: JSON.parse(JSON.stringify({ ...currentMemory, pendingBotReply: prepared })),
    }, false);
    await this.chatbotRepository.updateConversation({
      id: conversation.id, state: conversation.state,
      memory: JSON.parse(JSON.stringify({ ...currentMemory, pendingBotReply: { ...prepared, sending: true } })),
    }, false);
    const latestControl = await this.chatbotRepository.getConversationControl(conversation.id);
    const latestMemory = normalizeMemory(latestControl?.memory);
    if (latestControl?.state === "FINISHED") return { state: "FINISHED", replied: false, delayMs: 0, finished: true };
    if (latestMemory.humanTakeover || latestMemory.blocked || ["BLOCKED", "HUMAN_HANDOFF", "MANUAL"].includes(latestControl?.state ?? "")) {
      return { state: latestControl?.state ?? conversation.state, replied: false, delayMs: 0, humanTakeover: true };
    }
    let evolutionResult: unknown;
    try {
      if (this.delivery) {
        await this.delivery.send({ phone, message: next.reply });
      } else if (provider === "meta") {
        const destinationPhone = await this.resolveMetaDestinationPhone(phone);
        await sendMetaTextMessage({ to: destinationPhone, message: next.reply });
      } else if (provider === "evolution") {
        const destinationPhone = await this.resolveEvolutionDestinationPhone(phone);
        evolutionResult = await sendEvolutionTextMessage({ to: destinationPhone, message: next.reply, delayTypingSeconds: typingEnabled ? delaySeconds : undefined });
      } else {
        await this.zapiService.sendText({
          phone,
          message: next.reply,
          delayTypingSeconds: typingEnabled ? delaySeconds : undefined,
          config: agentConfig(agent),
        });
        if (next.interactive?.type === "button-list") {
          try {
            await this.zapiService.sendButtonList({
              phone,
              message: next.interactive.message,
              buttons: next.interactive.buttons,
              config: agentConfig(agent),
            });
          } catch {
            // Fallback keeps the conversational text already sent.
          }
        }
        if (next.interactive?.type === "option-list") {
          try {
            await this.zapiService.sendOptionList({
              phone,
              title: next.interactive.title,
              message: next.interactive.message,
              buttonLabel: next.interactive.buttonLabel,
              options: next.interactive.options,
              config: agentConfig(agent),
            });
          } catch {
            // Fallback keeps the conversational text already sent.
          }
        }
      }
    } catch (error) {
      await this.chatbotRepository.updateConversation({
        id: conversation.id, state: conversation.state,
        memory: JSON.parse(JSON.stringify({ ...currentMemory, pendingBotReply: { ...prepared, sending: true }, humanTakeover: true,
          takeoverReason: "Falha ou entrega incerta. Conferir histórico antes de reenviar.", takeoverAt: new Date().toISOString() })),
      });
      throw error;
    }
    const evolutionMessageId = provider === "evolution" ? resolveEvolutionMessageId(evolutionResult) : undefined;
    const evolutionInstance = evolutionMessageId ? currentEvolutionInstance().instanceName : undefined;
    await this.chatbotRepository.saveMessage({
      conversationId: conversation.id,
      direction: "outbound",
      body: next.reply,
      providerId: evolutionMessageId && evolutionInstance ? scopedEvolutionId(evolutionInstance, evolutionMessageId)
        : input.providerId ? `reply-to:${input.providerId}` : undefined,
      rawPayload: { inReplyTo: input.batchMessages?.map(m => m.providerId) ?? (input.providerId ? [input.providerId] : []),
        ...(evolutionMessageId ? { provider: "evolution", instanceName: evolutionInstance!, providerMessageId: evolutionMessageId } : {}) },
    });
    await this.chatbotRepository.updateConversation({
      id: conversation.id, state: next.state,
      memory: JSON.parse(JSON.stringify(next.memory)), leadId: next.leadId,
    }, false);

    return { state: next.state, replied: true, delayMs: typingEnabled ? delaySeconds * 1000 : 0 };
  }

  private async resolveEvolutionDestinationPhone(phone: string) {
    try {
      // This number is already the authenticated inbound WhatsApp sender.
      if (/^55\d{10,11}$/.test(phone)) return phone;
      const checked = await checkEvolutionWhatsAppNumber(phone);
      if (checked.exists && checked.phone) return checked.phone;
    } catch {
      // If validation is unavailable, keep the original webhook phone so the flow is not blocked.
    }
    return phone;
  }

  private async resolveMetaDestinationPhone(phone: string) {
    try {
      const checked = await checkMetaWhatsAppNumber(phone);
      if (checked.exists && checked.phone) return checked.phone;
    } catch {
      // Meta Cloud API valida na tentativa de envio; mantenha o telefone original.
    }
    return phone;
  }

  private async nextResponse(input: {
    phone: string;
    message: string;
    state: string;
    memory: ChatMemory;
    agent: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>;
    extractedData?: ExtractedCustomerData;
    interpretation?: ConversationInterpretation | null;
    parts?: string[];
    requestId?: string;
    instanceId?: string;
  }): Promise<NextBotResponse> {
    if (input.state === "FINISHED") return { state: "FINISHED", memory: { ...input.memory }, reply: "" };
    const originalText = input.message.trim();
    const motherContext = input.state === "ASK_MOTHER_NAME" || (input.state === "CORRECTION" && (input.memory.correctionField === "motherName" || parseCorrectionField(originalText) === "motherName"));
    const memory = { ...input.memory, automationReplyDetected: false };
    if (input.extractedData) applyValidatedExtractedData(memory, { ...input.extractedData, ...(motherContext ? { fullName: undefined } : {}) });
    const text = extractedValueForState(input.state, input.extractedData) ?? originalText;
    if (!/^\[(?:Áudio|Imagem|Documento|Arquivo)/i.test(text)) memory.mediaFailureCount = 0;
    const firstName = getFirstName(memory.name);
    applyParsedCustomerData(memory, text, input.state);
    const evidence = input.interpretation?.evidence ?? {};
    for (const [key, source] of Object.entries(evidence)) if (key !== "motherName" && !(motherContext && key === "name")) applyParsedCustomerData(memory, source, "EARLY_DATA");
    applyValidatedExtractedData(memory, { fullName: motherContext ? undefined : evidence.name, motherName: evidence.motherName, cep: evidence.cep, cpf: evidence.document,
      birthDate: evidence.birthDate, email: evidence.email, streetNumber: evidence.streetNumber });
    if (evidence.complement && evidence.complement.length < 160) memory.complement = normalizeComplement(evidence.complement);
    const earlyName = extractLabeledName(originalText);
    if (earlyName && !motherContext && !extractMotherName(originalText)) memory.name = earlyName;
    const earlyCep = originalText.match(/\bcep\s*[:=]?\s*(\d{5}[- ]?\d{3})\b/i)?.[1];
    if (earlyCep) memory.cep = onlyDigits(earlyCep);
    const plans = await this.getPlans(input.agent);
    if ((input.parts?.length ?? 0) > 1) applyBatchData(memory, input.parts!, input.state, plans);
    if (!["START", "ASK_CEP", "CORRECTION"].includes(input.state) && memory.cep && memory.cep !== input.memory.cep && coverageDataset(input.agent) && !(await this.validateCoverage(memory.cep, input.agent)).available) return coverageUnavailable(memory, memory.cep);
    const mentionedPlan = selectPlan(evidence.plan || text, plans);
    const explicitPlan = (Boolean(evidence.plan) || /(?:trocar|mudar|alterar|prefiro|quero|plano|ficar com|opcao)/i.test(normalizeText(text)))
      && /\b(600|700|800|1000|1\s*giga|seiscentos|setecentos|oitocentos|disney)\b/i.test(normalizeText(text))
      && !text.includes("?") && !/\bnao\b/.test(normalizeText(text));
    const conflict = conflictingFields(originalText, input.state === "ASK_EMAIL" && isEmailAnswer(text));
    if (conflict) return { state: input.state, memory: { ...input.memory }, reply: `${conflict}\n\n${promptForState(input.state, firstName)}` };
    if (hasInjection(originalText)) return { state: input.state, memory: { ...input.memory }, reply: `Posso ajudar, mas não posso alterar condições comerciais nem confirmar ações que não foram realizadas.\n\n${promptForState(input.state, firstName)}` };
    if (explicitPlan && mentionedPlan && input.state !== "CHOOSE_PLAN" && input.state !== "FINISHED") {
      memory.planId = mentionedPlan.id; memory.planName = mentionedPlan.name; memory.planValue = Number(mentionedPlan.price);
      memory.pendingUpsellPlanId = undefined;
      if (input.state === "CONFIRM_DATA" || input.state === "CORRECTION") return { state: "CONFIRM_DATA", memory, reply: `Plano alterado.\n\n${buildSummary(memory)}\n\nConfirma os dados? Responda SIM ou NÃO.` };
      if (input.state !== "START") return { state: input.state, memory, reply: `Anotado: ${mentionedPlan.name} por ${formatMoney(Number(mentionedPlan.price))}/mês.\n\n${promptForState(input.state, firstName)}` };
    }

    if (isStopRequest(text)) {
      return { state: input.state, memory: { ...memory, humanTakeover: true, salesPaused: true, followUpPaused: true, takeoverReason: "Cliente pediu para encerrar o atendimento.", takeoverAt: new Date().toISOString() }, reply: "Tudo bem, encerrei o atendimento por aqui. Se precisar, nossa equipe fica à disposição." };
    }

    if (isRestartRequest(text)) {
      return {
        state: "ASK_CEP",
        memory: {},
        reply: greetingMessage(input.agent?.name),
      };
    }

    if (isHandoffRequest(text) || input.interpretation?.intent === "handoff") {
      memory.handoff = true;
      memory.humanTakeover = true;
      memory.takeoverAt = new Date().toISOString();
      memory.takeoverReason = "Cliente pediu atendimento humano.";
      return {
        state: input.state,
        memory,
        reply: "Combinado, vou sinalizar para uma consultora humana continuar seu atendimento por aqui. 😊",
      };
    }

    if (input.extractedData && text === originalText && !hasUsefulExtractedDataForState(input.state, input.extractedData)) {
      return {
        state: input.state,
        memory,
        reply: mediaFallbackReply(input.state, firstName),
      };
    }

    if (/^\[(Áudio|Imagem|Documento|Arquivo)/i.test(text) || (input.extractedData && !Object.keys(input.extractedData).length)) {
      memory.mediaFailureCount = (memory.mediaFailureCount ?? 0) + 1;
      if (memory.mediaFailureCount >= 3) return { state: input.state, memory: { ...memory, humanTakeover: true, takeoverAt: new Date().toISOString(), takeoverReason: "Falhas repetidas ao interpretar mídia." }, reply: "Não consegui identificar o conteúdo com segurança. Vou sinalizar para uma consultora humana continuar seu atendimento por aqui. 😊" };
      return { state: input.state, memory, reply: `Não consegui identificar o conteúdo com segurança. Pode escrever a informação?\n\n${promptForState(input.state, firstName)}` };
    }
    if (input.state === "ASK_EMAIL" && isEmailAnswer(text)) {
      // Preserve what the customer supplied for the operator; never invent an address.
      memory.email = text;
      memory.emailCollected = true;
      return { state: "ASK_BILLING_DUE_DAY", memory, reply: billingDueDayPrompt() };
    }
    if (input.interpretation?.intent === "unclear" || /^(nao sei|sei la|nao entendi|ahn)$/.test(normalizeText(text)) || /^\?+$/.test(text.trim())) {
      memory.confusionCount = (memory.confusionCount ?? 0) + 1;
      if (memory.confusionCount >= 3) {
        memory.humanTakeover = true; memory.takeoverReason = "Dificuldade repetida de interpretação.";
        return { state: input.state, memory, reply: "Para evitar que você precise repetir, vou sinalizar este atendimento para uma consultora humana. Mantive os dados já informados." };
      }
    }
    const official = officialAnswer(text);
    if (official) return { state: input.state, memory, reply: `${official}\n\n${promptForState(input.state, firstName)}` };
    if (/voltei|continuar|onde paramos|retomar/.test(normalizeText(text))) {
      return { state: input.state, memory, reply: `Que bom ter você de volta! Mantive os dados já informados.\n\n${promptForState(input.state, firstName)}` };
    }
    if (/irritad|chatead|que saco|muita pergunta|perguntas demais|reclam|demorad/.test(normalizeText(text)) || input.interpretation?.tone === "frustrated") {
      return { state: input.state, memory, reply: `Entendo a sua frustração. Vamos por partes, sem repetir o que você já informou. Se preferir, pode pedir uma atendente.\n\n${promptForState(input.state, firstName)}` };
    }
    if (asksForPlanRecommendation(text) || input.interpretation?.intent === "recommendation") {
      const plans = await this.getPlans(input.agent);
      const recommended = findRecommendedPlan(plans, text);
      const recommendation = recommended
        ? `Para essa necessidade, recomendo o ${recommended.name} por ${formatMoney(Number(recommended.price))}/mês.\n${recommended.description ?? "Confira os benefícios cadastrados."}`
        : "No momento não há planos ativos vinculados a este atendimento.";
      return {
        state: input.state,
        memory,
        reply: `${recommendation}\n\n${promptForState(input.state, firstName)}`,
      };
    }

    if (asksForPlanList(text) || isPlanQuestion(text)) {
      const plans = await this.getPlans(input.agent);
      return {
        state: input.state,
        memory,
        reply: `Claro! 😊 Estes são os planos disponíveis:\n\n${formatPlanList(plans)}\n\n${promptForState(input.state, firstName)}`,
      };
    }

    const criticalAnswer = input.state === "CONFIRM_DATA" && (isPositive(text) || isNegative(text));
    if (!criticalAnswer && (shouldAnswerOutsideFlow(text, input.state) || ["question", "smalltalk", "unclear"].includes(input.interpretation?.intent ?? "") || /^(kkk+|rsrs|eae|e ai|opa|salve|nao sei|sei la|conte uma piada)/.test(normalizeText(text)))) {
      if (input.state === "ASK_DOCUMENT" && asksWhyCpf(text)) {
        return {
          state: input.state,
          memory,
          reply: "O CPF é necessário para realizar a análise e o cadastro da contratação. 🔐\nEle faz parte dos dados necessários para encaminharmos sua solicitação.\n\nDepois disso, continuamos normalmente de onde paramos. 😊\nPode me informar seu CPF?",
        };
      }
      const aiReply = safeFreeReply(input.interpretation?.reply ?? "", input.message);
      const answer = aiReply || await this.answerOutsideFlow({
        message: text,
        state: input.state,
        agent: input.agent,
        customerName: memory.name,
      });
      return {
        state: input.state,
        memory,
        reply: `${answer}\n\n${promptForState(input.state, firstName)}`,
      };
    }

    if (input.state === "START" && memory.cep) {
      const coverage = await this.validateCoverage(memory.cep, input.agent);
      if (coverage.available === false) return coverageUnavailable(memory, memory.cep);
      applyAddress(memory, { street: coverage?.street ?? undefined, city: coverage?.city ?? undefined, state: coverage?.state ?? undefined, neighborhood: coverage?.neighborhood ?? undefined });
      const next = afterKnownAddress(memory, plans);
      return { ...next, reply: `Olá! Sou a ${input.agent?.name ?? "Lily"}. Já anotei as informações que você enviou.\n\n${next.reply}` };
    }
    if (input.state === "START") {
      return {
        state: "ASK_CEP",
        memory,
        reply: greetingMessage(input.agent?.name),
      };
    }

    if (input.state === "ASK_CEP") {
      const cep = memory.cep || parseCep(text);
      if (!cep) {
        return {
          state: "ASK_CEP",
          memory,
          reply: "Esse CEP parece incompleto. Pode me enviar os 8 números do CEP da instalação, por favor? 😊",
        };
      }

      const coverage = await this.validateCoverage(cep, input.agent);
      if (coverage.available === false) return coverageUnavailable(memory, cep);
      const viaCep = coverage?.street && coverage?.city && coverage?.state ? null : await fetchViaCep(cep);
      memory.cep = cep;
      applyAddress(memory, {
        street: coverage?.street ?? viaCep?.street,
        neighborhood: coverage?.neighborhood ?? viaCep?.neighborhood,
        city: coverage?.city ?? viaCep?.city,
        state: coverage?.state ?? viaCep?.state,
      });

      const next = afterKnownAddress(memory, plans);
      return { ...next, reply: `${formatAddressShort(memory)}\n\n${next.reply}` };
    }

    if (input.state === "ASK_STREET_NUMBER") {
      const streetNumber = memory.streetNumber || parseSimpleNumber(text);
      if (!streetNumber) {
        return {
          state: "ASK_STREET_NUMBER",
          memory,
          reply: "Pode me informar somente o número da residência, por favor? 😊",
        };
      }
      memory.streetNumber = streetNumber;
      if (memory.complement !== undefined) return afterKnownAddress(memory, plans);
      return {
        state: "ASK_COMPLEMENT",
        memory,
        reply: "Anotado! 😊\nO endereço possui algum complemento, como apartamento, bloco, condomínio ou casa dos fundos? 🏠\nSe não tiver, pode responder apenas “Não”.",
      };
    }

    if (input.state === "ASK_COMPLEMENT" && /n[uú]mero\s+(?:correto|certo)|n[uú]mero(?:\s+da\s+casa)?\s+(?:[eé]|correto|certo)/i.test(text)) {
      const correctedNumber = text.match(/n[uú]mero(?:\s+(?:correto|certo|da|casa|resid[eê]ncia|[eé]|o)){0,6}\s*[:,=-]?\s*(\d{1,6}[a-z]?)(?=\s|[,.]|$)/i)?.[1];
      if (correctedNumber) { memory.streetNumber = correctedNumber; return { state: "ASK_COMPLEMENT", memory, reply: `Número atualizado para ${correctedNumber}.\n\n${promptForState("ASK_COMPLEMENT", firstName)}` }; }
    }
    if (input.state === "ASK_COMPLEMENT") {
      memory.complement = normalizeComplement(text);
      if (memory.planId) return nextCustomerDataResponse(memory, `Endereço registrado.\n\n`);
      const plans = await this.getPlans(input.agent);
      return {
        state: "CHOOSE_PLAN",
        memory,
        reply: `Perfeito! 😊 Seu endereço ficou:\n📍 ${formatAddressForPlanIntro(memory)}\n\nAgora vou te apresentar os planos disponíveis para contratação. 🛜🚀\n\n${formatPlanList(plans)}\n${costBenefitHint(plans)}\nQual você prefere?\n👉 Pode me responder apenas com o número da opção.`,
        interactive: buildPlanOptionList(plans),
      };
    }

    if (input.state === "ASK_ADDRESS_CONFIRM") {
      const plans = await this.getPlans(input.agent);
      return {
        state: "CHOOSE_PLAN",
        memory,
        reply: `Perfeito 🎉!\n\n${formatPlanList(plans)}\n\nQual plano você prefere?`,
        interactive: buildPlanOptionList(plans),
      };
    }

    if (input.state === "ASK_NAME") {
      const name = fullName(text) || memory.name;
      if (!name) return { state: "ASK_NAME", memory, reply: "Pode me informar seu nome completo, com nome e sobrenome, por favor?" };
      memory.name = name;
      return nextCustomerDataResponse(memory, `Muito prazer, ${getFirstName(memory.name)}! 😊\nSeu nome já está registrado. ✅\n\n`);
    }

    if (input.state === "CHOOSE_PLAN") {
      const plans = await this.getPlans(input.agent);
      const selectedPlan = selectPlan(text, plans);

      if (memory.pendingUpsellPlanId && memory.planId) {
        const pendingUpsell = plans.find((plan) => plan.id === memory.pendingUpsellPlanId);
        const originalPlan = plans.find((plan) => plan.id === memory.planId);
        const selectedPending = selectedPlan?.id === pendingUpsell?.id;
        const selectedOriginal = selectedPlan?.id === originalPlan?.id;

        if ((isPositive(text) || /^(?:pode ser|pode sim|aceito)[.!\s]*$/.test(normalizeText(text)) || selectedPending) && pendingUpsell) {
          memory.pendingUpsellPlanId = undefined;
          return this.selectPlanAndConfirm({ memory, plan: pendingUpsell });
        }

        if ((isNegative(text) || wantsOriginalPlan(text) || selectedOriginal) && originalPlan && pendingUpsell) {
          memory.pendingUpsellPlanId = undefined;
          memory.declinedUpsellPlanIds = [...(memory.declinedUpsellPlanIds ?? []), pendingUpsell.id];
          return this.selectPlanAndConfirm({
            memory,
            plan: originalPlan,
            prefix: `Sem problemas! 😊\nEntão vamos continuar com:\n🛜 ${originalPlan.name}\n💰 ${formatMoney(Number(originalPlan.price))}/mês\n\n`,
          });
        }
      }

      if (!selectedPlan) {
        if (isPlanRefusal(text)) {
          return this.handlePlanObjection({ text, state: "CHOOSE_PLAN", memory, plans, agent: input.agent });
        }
        return {
          state: "CHOOSE_PLAN",
          memory,
          reply: `Claro! 😊 Estes são os planos disponíveis:\n\n${formatPlanList(plans)}\n\nQual você prefere? Pode responder com o número da opção ou com o nome do plano.`,
          interactive: buildPlanOptionList(plans),
        };
      }

      const upsell = findUpsellCandidate(selectedPlan, plans, memory);
      if (upsell) {
        memory.planId = selectedPlan.id;
        memory.planName = selectedPlan.name;
        memory.planValue = Number(selectedPlan.price);
        memory.pendingUpsellPlanId = upsell.id;
        memory.offeredUpsellPlanIds = [...(memory.offeredUpsellPlanIds ?? []), upsell.id];
        return {
          state: "CHOOSE_PLAN",
          memory,
          reply: upsellMessage(selectedPlan, upsell),
        };
      }

      return {
        ...this.selectPlanAndConfirm({ memory, plan: selectedPlan }),
      };
    }

    if (input.state === "ASK_MOTHER_NAME") {
      const motherName = extractMotherName(text) || fullName(text);
      if (!motherName) return { state: "ASK_MOTHER_NAME", memory, reply: "Pode me informar o nome completo da sua mãe, com nome e sobrenome, por favor?" };
      memory.motherName = motherName;
      return nextCustomerDataResponse(memory);
    }

    if (input.state === "ASK_DOCUMENT") {
      const document = parseDocument(text);
      if (!document.valid && !memory.cpfCnpj) {
        return {
          state: "ASK_DOCUMENT",
          memory,
          reply: "Esse CPF ou CNPJ não parece válido. Pode conferir e me enviar novamente, por favor? 😊",
        };
      }
      if (document.valid) {
        memory.cpfCnpj = document.formatted;
        memory.documentType = document.type;
      }
      return nextCustomerDataResponse(memory, `Perfeito! ✅ ${memory.documentType ?? "CPF"} registrado.\nEstamos avançando com seu cadastro. 😊\n\n`);
    }

    if (input.state === "ASK_BIRTH_DATE") {
      const birthDate = parseBirthDate(text);
      if (!birthDate && !memory.birthDate) {
        return {
          state: "ASK_BIRTH_DATE",
          memory,
          reply: "Não consegui identificar a data. Pode enviar no formato 26/01/1998, por favor? 😊",
        };
      }
      if (birthDate) memory.birthDate = birthDate.toISOString();
      return nextCustomerDataResponse(memory, `Perfeito! 🎉\n📅 Data de nascimento registrada: ${formatDate(new Date(memory.birthDate ?? ""))}\nEstamos quase terminando seus dados. 😊\n\n`);
    }

    if (input.state === "ASK_BILLING_DUE_DAY") {
      const billingDay = parseBillingDay(text);
      if (!billingDay) {
        return {
          state: "ASK_BILLING_DUE_DAY",
          memory,
          reply: "A data de vencimento pode ser 5, 8, 10, 15, 20 ou 25. Qual você prefere? 📅",
        };
      }
      memory.billingDueDay = billingDay;
      return {
        state: "CONFIRM_DATA",
        memory,
        reply: `Perfeito! 😊 Vencimento escolhido para o dia ${billingDay}.\nChegamos à última confirmação. 🎉\n\n${buildSummary(memory)}\n\nEstá tudo correto? 😊\n👉 Digite *SIM* para confirmar sua solicitação.\nCaso alguma informação esteja incorreta, responda *NÃO* que eu te ajudo a corrigir.`,
      };
    }

    if (input.state === "CONFIRM_DATA") {
      const requestedCorrection = parseCorrectionField(text);
      if (requestedCorrection && /corrig|errad|alter|trocar|mudar|nao [eé]|falta|nome da m[aã]e/i.test(text) && !looksLikeQuestion(text)) {
        if (validCorrection(requestedCorrection, text, plans)) return this.nextResponse({ ...input, state: "CORRECTION", memory: { ...memory, correctionField: requestedCorrection } });
        return { state: "CORRECTION", memory: { ...memory, correctionField: requestedCorrection }, reply: correctionPrompt(requestedCorrection) };
      }
      if (isPositive(text)) {
        if (!memory.cep || !/^\d{8}$/.test(memory.cep)) return { state: "ASK_CEP", memory, reply: promptForState("ASK_CEP") };
        if (coverageDataset(input.agent) && !(await this.validateCoverage(memory.cep, input.agent)).available) return coverageUnavailable(memory, memory.cep);
        if (!memory.streetNumber || !parseSimpleNumber(memory.streetNumber)) return { state: "ASK_STREET_NUMBER", memory, reply: promptForState("ASK_STREET_NUMBER") };
        if (!memory.complement) return { state: "ASK_COMPLEMENT", memory, reply: promptForState("ASK_COMPLEMENT") };
        const incomplete = nextCustomerDataResponse(memory);
        if (incomplete.state !== "CONFIRM_DATA") return incomplete;
        const activePlan = plans.find(p => p.id === memory.planId);
        if (!activePlan) return { state: "CHOOSE_PLAN", memory: { ...memory, planId: undefined }, reply: `O plano anterior não está mais disponível. Escolha uma opção ativa:\n\n${formatPlanList(plans)}` };
        if (Number(activePlan.price) !== memory.planValue || activePlan.name !== memory.planName) return { state: "CONFIRM_DATA", memory: { ...memory, planValue: Number(activePlan.price), planName: activePlan.name }, reply: `O catálogo foi atualizado. Confira o valor antes de confirmar:\n\n${buildSummary({ ...memory, planValue: Number(activePlan.price), planName: activePlan.name })}\n\nConfirma? Responda SIM ou NÃO.` };
        const lead = await this.chatbotRepository.createLeadFromChat({
          name: memory.name ?? "Lead WhatsApp",
          motherName: memory.motherName,
          phone: memory.whatsapp ?? input.phone,
          email: memory.email,
          cpfCnpj: memory.cpfCnpj,
          birthDate: memory.birthDate ? new Date(memory.birthDate) : undefined,
          cep: memory.cep,
          address: memory.address,
          streetNumber: memory.streetNumber,
          complement: memory.complement,
          city: memory.city,
          state: memory.state,
          neighborhood: memory.neighborhood,
          billingDueDay: memory.billingDueDay,
          planId: memory.planId,
          planName: memory.planName,
          expectedValue: memory.planValue,
          notes: `Lead finalizado pelo fluxo do chatbot Lily. Instância: ${input.instanceId ?? "legado"}.`,
          requestId: input.requestId,
        });

        if (!lead?.id) throw new Error("O sistema não confirmou o registro do lead.");
        return {
          state: "FINISHED",
          memory,
          leadId: lead.id,
          reply: `Perfeito, ${getFirstName(memory.name) || "cliente"}! 🎉💙\nSua solicitação foi registrada com sucesso. ✅\n\nAgora seus dados seguirão para análise, validação das informações e verificação da disponibilidade para instalação no endereço. 🛜\n\n📱 Fique atento ao seu celular, pois nossa equipe poderá entrar em contato para concluir a validação.\n\nPara agilizar o atendimento, deixe separado:\n🪪 RG ou CNH\n🏠 Comprovante de residência\n\nApós a validação e aprovação, nossa equipe seguirá com você para verificar as opções disponíveis e, sendo possível a instalação, realizar o agendamento. 🚀\n\n⚠️ É importante atender ao contato da nossa equipe para evitar atrasos na sua solicitação.\nObrigado pela preferência! 💙`,
        };
      }

      if (isNegative(text)) {
        return {
          state: "CORRECTION",
          memory,
          reply: "Sem problemas! 😊 Vamos corrigir.\nMe informe qual dado precisa ser alterado:\n1️⃣ Nome\n2️⃣ CPF\n3️⃣ Data de nascimento\n4️⃣ E-mail\n5️⃣ Endereço\n6️⃣ Vencimento\n7️⃣ Plano\n8️⃣ Nome da mãe\n\n👉 Digite o número da opção que deseja corrigir.\nApós a correção, eu te mostro novamente o resumo completo antes de confirmar. ✅",
        };
      }

      return {
        state: "CONFIRM_DATA",
        memory,
        reply: `${buildSummary(memory)}\n\nEstá tudo correto? ✅\n\nDigite *SIM* ou *NÃO*.`,
      };
    }

    if (input.state === "CORRECTION") {
      const correctionField = memory.correctionField ?? parseCorrectionField(text);
      if (!correctionField) {
        return {
          state: "CORRECTION",
          memory,
          reply: "Me diga qual dado quer corrigir:\n1️⃣ Nome\n2️⃣ CPF\n3️⃣ Data de nascimento\n4️⃣ E-mail\n5️⃣ Endereço\n6️⃣ Vencimento\n7️⃣ Plano\n8️⃣ Nome da mãe",
        };
      }
      if (!memory.correctionField && isCorrectionChoiceOnly(text)) {
        memory.correctionField = correctionField;
        return {
          state: "CORRECTION",
          memory,
          reply: correctionPrompt(correctionField),
        };
      }
      if (!validCorrection(correctionField, text, plans)) return { state: "CORRECTION", memory: { ...memory, correctionField }, reply: `Não consegui validar a correção. ${correctionPrompt(correctionField)}` };
      const corrected = await this.applyCorrection(text, { ...memory, correctionField }, input.agent);
      if (corrected.cep && coverageDataset(input.agent) && !(await this.validateCoverage(corrected.cep, input.agent)).available) return coverageUnavailable(corrected, corrected.cep);
      corrected.correctionField = undefined;
      return {
        state: "CONFIRM_DATA",
        memory: corrected,
        reply: `${buildSummary(corrected)}\n\nEstá tudo correto? 😊\n👉 Digite *SIM* para confirmar sua solicitação.\nCaso ainda tenha algo incorreto, responda *NÃO*.`,
      };
    }

    if (input.state === "FINISHED_UNAVAILABLE") {
      return {
        state: "FINISHED_UNAVAILABLE",
        memory,
        reply: "Esse atendimento foi finalizado porque ainda não temos cobertura nesse CEP. Se quiser consultar outro endereço, envie reiniciar. 😊",
      };
    }


    return {
      state: "ASK_CEP",
      memory: {},
      reply: greetingMessage(input.agent?.name),
    };
  }

  private async getPlans(agent: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>) {
    if (Array.isArray(agent?.plans)) return agent.plans;
    if (!agent) return this.chatbotRepository.listActivePlans();
    return this.chatbotRepository.listActivePlans(agent.id);
  }

  private selectPlanAndConfirm(input: { memory: ChatMemory; plan: PlanCandidate; prefix?: string }): NextBotResponse {
    const memory = {
      ...input.memory,
      planId: input.plan.id,
      planName: input.plan.name,
      planValue: Number(input.plan.price),
      pendingUpsellPlanId: undefined,
    };

    return nextCustomerDataResponse(
      memory,
      input.prefix ?? selectedPlanMessage(input.plan),
    );
  }

  private async handlePlanObjection(input: {
    text: string;
    state: string;
    memory: ChatMemory;
    plans: PlanCandidate[];
    agent: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>;
  }): Promise<NextBotResponse> {
    const memory = { ...input.memory, objectionCount: (input.memory.objectionCount ?? 0) + 1 };

    if (memory.objectionCount >= 3) {
      return {
        state: input.state,
        memory,
        reply: "Entendo! Se mudar de ideia ou precisar de alguma informação é só me avisar. 😁",
      };
    }

    const answer = await this.answerPlanQuestion({
      customerMessage: `O cliente apresentou objeção. Tentativa ${memory.objectionCount} de 3: ${input.text}`,
      customerName: memory.name,
      plans: input.plans.map((plan, index) => ({
        order: index + 1,
        name: plan.name,
        speed: plan.speed,
        price: Number(plan.price),
        description: plan.description,
      })),
      agent: input.agent,
    });

    return {
      state: input.state,
      memory,
      reply: answer || "Entendo você 😊 Se quiser, posso te ajudar a comparar as opções disponíveis pelo custo-benefício. Qual plano faz mais sentido pra você?",
    };
  }

  private async applyCorrection(
    text: string,
    memory: ChatMemory,
    agent: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>,
  ) {
    const corrected = { ...memory };
    const normalized = normalizeText(text);
    const plans = await this.getPlans(agent);
    const selectedPlan = selectPlan(text, plans);
    const billingDay = parseBillingDay(text);
    const email = parseEmail(text);
    const birthDate = parseBirthDate(text);
    const document = parseDocument(text);
    const cep = parseCep(text);

    if (corrected.correctionField === "motherName") {
      corrected.motherName = extractMotherName(text) || fullName(text);
    } else if (corrected.correctionField === "plan" && selectedPlan) {
      corrected.planId = selectedPlan.id;
      corrected.planName = selectedPlan.name;
      corrected.planValue = Number(selectedPlan.price);
    } else if (corrected.correctionField === "billing" && billingDay) {
      corrected.billingDueDay = billingDay;
    } else if (corrected.correctionField === "email" && isEmailAnswer(text)) {
      corrected.email = text.trim();
      corrected.emailCollected = true;
    } else if (corrected.correctionField === "birthDate" && birthDate) {
      corrected.birthDate = birthDate.toISOString();
    } else if (corrected.correctionField === "document" && document.valid) {
      corrected.cpfCnpj = document.formatted;
      corrected.documentType = document.type;
    } else if (corrected.correctionField === "address" && cep) {
      corrected.cep = cep;
      const coverage = await this.validateCoverage(cep, agent);
      if (coverage.available === false) return corrected;
      const viaCep = coverage.street && coverage.city && coverage.state ? null : await fetchViaCep(cep);
      applyAddress(corrected, {
        street: coverage?.street ?? viaCep?.street,
        neighborhood: coverage?.neighborhood ?? viaCep?.neighborhood,
        city: coverage?.city ?? viaCep?.city,
        state: coverage?.state ?? viaCep?.state,
      });
    } else if (corrected.correctionField === "address" && /numero|n[uú]mero|casa|residencia|residência/.test(normalized)) {
      corrected.streetNumber = parseSimpleNumber(text) ?? corrected.streetNumber;
    } else if (corrected.correctionField === "address" && /complemento|apto|apartamento|casa|bloco|fundos/.test(normalized)) {
      corrected.complement = normalizeComplement(text.replace(/complemento/gi, "").trim());
    } else if (corrected.correctionField === "name" && fullName(text)) {
      corrected.name = fullName(text);
    } else if (selectedPlan) {
      corrected.planId = selectedPlan.id;
      corrected.planName = selectedPlan.name;
      corrected.planValue = Number(selectedPlan.price);
    } else if (billingDay && /vencimento|dia|boleto|fatura/.test(normalized)) {
      corrected.billingDueDay = billingDay;
    } else if (email) {
      corrected.email = email;
    } else if (birthDate) {
      corrected.birthDate = birthDate.toISOString();
    } else if (document.valid) {
      corrected.cpfCnpj = document.formatted;
      corrected.documentType = document.type;
    } else if (cep) {
      corrected.cep = cep;
      const coverage = await this.validateCoverage(cep, agent);
      if (coverage.available === false) return corrected;
      const viaCep = coverage.street && coverage.city && coverage.state ? null : await fetchViaCep(cep);
      applyAddress(corrected, {
        street: coverage?.street ?? viaCep?.street,
        neighborhood: coverage?.neighborhood ?? viaCep?.neighborhood,
        city: coverage?.city ?? viaCep?.city,
        state: coverage?.state ?? viaCep?.state,
      });
    } else if (/numero|n[uú]mero|casa|residencia|residência/.test(normalized)) {
      corrected.streetNumber = parseSimpleNumber(text) ?? corrected.streetNumber;
    } else if (/complemento|apto|apartamento|casa|bloco|fundos/.test(normalized)) {
      corrected.complement = normalizeComplement(text.replace(/complemento/gi, "").trim());
    } else if (!corrected.correctionField && (/nome/.test(normalized) || text.split(/\s+/).length >= 2)) {
      const name = fullName(text);
      if (name) corrected.name = name;
    }

    if (corrected.correctionField === "address") applyManualAddress(corrected, text);
    return corrected;
  }

  private async answerPlanQuestion(input: {
    customerMessage: string;
    customerName?: string;
    plans: Array<{ order: number; name: string; speed: string; price: number; description: string | null }>;
    agent: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>;
  }) {
    try {
      const planLines = input.plans
        .map((plan) => `${plan.order}. ${plan.name} ${plan.speed} - ${formatMoney(plan.price)}${plan.description ? ` - ${plan.description}` : ""}`)
        .join("\n");

      return await this.openAiService.answerCommercialQuestion(
        [
          `Voce e ${input.agent?.name ?? "Lily"}, consultora comercial de planos de internet fibra em um atendimento pelo WhatsApp.`,
          `Personalidade: ${input.agent?.personality ?? "Vendedora humana, simpatica, persuasiva e objetiva."}`,
          `Regras personalizadas:\n${formatAgentRules(input.agent?.rules)}`,
          "Responda em portugues do Brasil, de forma breve, vendedora e natural.",
          "Nunca invente preco, cobertura, operadora disponivel, prazo, taxa, fidelidade, promocao ou plano. Use somente os dados listados.",
          "Use no maximo um emoji.",
          "Depois de responder, conduza o cliente para escolher um plano.",
          `Cliente: ${input.customerName ?? "cliente"}`,
          `Planos disponiveis:\n${planLines || "Valores ainda nao cadastrados."}`,
          `Mensagem do cliente: ${input.customerMessage}`,
        ].join("\n\n"),
      );
    } catch {
      return "";
    }
  }

  private async answerOutsideFlow(input: {
    message: string;
    state: string;
    customerName?: string;
    agent: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>;
  }) {
    try {
      const reply = await this.openAiService.answerCommercialQuestion(
        [
          `Voce e ${input.agent?.name ?? "Lily"}, assistente virtual comercial de planos de internet fibra.`,
          `Personalidade: ${input.agent?.personality ?? "Vendedora humana, cordial e objetiva."}`,
          `Regras:\n${formatAgentRules(input.agent?.rules)}`,
          `O funil esta na etapa ${input.state}. Responda a duvida sem pular etapa.`,
          "Pode conversar sobre assuntos gerais com respeito e segurança; depois retome o cadastro.",
          "Nunca confirme cobertura, disponibilidade tecnica, prazo, taxa, fidelidade ou promocao se essa informacao nao estiver cadastrada.",
          "Se perguntarem, explique que é a assistente virtual da Click Hubnet.",
          "Use no maximo um emoji.",
          `Cliente: ${input.customerName ?? "cliente"}`,
          `Condições oficiais: ${JSON.stringify(commercialKnowledge)}`,
          `Pergunta: ${input.message}`,
        ].join("\n\n"),
      );
      return safeFreeReply(reply, input.message) || "Posso continuar com você. Se preferir, também pode pedir uma atendente.";
    } catch {
      return "Posso te orientar sobre os planos e a solicitação de contratação. 😊";
    }
  }
}

type NextBotResponse = {
  state: string;
  memory: ChatMemory;
  reply: string;
  leadId?: string;
  interactive?: InteractivePayload;
};

type InteractivePayload =
  | {
      type: "button-list";
      title?: string;
      message: string;
      footer?: string;
      buttons: Array<{ id: string; label: string }>;
    }
  | {
      type: "option-list";
      title: string;
      message: string;
      buttonLabel: string;
      footer?: string;
      options: Array<{ id: string; title: string; description?: string }>;
    };

type PendingBotReply = { providerId?: string; sending: boolean; next: NextBotResponse; batchIds?: string[] };

type ChatMemory = {
  confusionCount?: number;
  mediaFailureCount?: number;
  automationReplyDetected?: boolean;
  salesPaused?: boolean;
  followUpPaused?: boolean;
  blocked?: boolean;
  pendingBotReply?: PendingBotReply;
  name?: string;
  motherName?: string;
  cep?: string;
  address?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  streetNumber?: string;
  complement?: string;
  cpfCnpj?: string;
  documentType?: "CPF" | "CNPJ";
  whatsapp?: string;
  birthDate?: string;
  email?: string;
  emailCollected?: boolean;
  billingDueDay?: number;
  planId?: string;
  planName?: string;
  planValue?: number;
  recommendedPlanId?: string;
  handoff?: boolean;
  humanTakeover?: boolean;
  takeoverAt?: string | null;
  takeoverReason?: string | null;
  objectionCount?: number;
  pendingUpsellPlanId?: string;
  offeredUpsellPlanIds?: string[];
  declinedUpsellPlanIds?: string[];
  correctionField?: CorrectionField;
};

type CorrectionField = "name" | "motherName" | "document" | "birthDate" | "email" | "address" | "billing" | "plan";

type PlanCandidate = {
  id: string;
  name: string;
  speed: string;
  price: unknown;
  description: string | null;
};

type ViaCepAddress = {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
};

function normalizeMemory(memory: unknown): ChatMemory {
  if (memory && typeof memory === "object" && !Array.isArray(memory)) {
    return memory as ChatMemory;
  }
  return {};
}

function randomDelaySeconds(minSeconds: number, maxSeconds: number) {
  const min = Math.max(0, minSeconds);
  const max = Math.max(min + 1, maxSeconds);
  return Math.max(1, Math.floor(Math.random() * (max - min) + min));
}

function normalizeWhatsappPhone(phone: string) {
  const normalized = phone.trim().toLowerCase();
  const digits = onlyDigits(phone).replace(/^00/, "");
  if (normalized.endsWith("@lid")) return `${digits}@lid`;
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function parseCep(text: string) {
  const explicitCep = text.match(/\b\d{5}-?\d{3}\b/);
  if (explicitCep) {
    return explicitCep[0].replace(/\D/g, "");
  }

  const spacedCep = text.match(/\b\d{5}\s+\d{3}\b/);
  if (spacedCep) {
    return spacedCep[0].replace(/\D/g, "");
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    const lineCep = line.match(/\b\d{5}-?\d{3}\b/);
    if (lineCep) return lineCep[0].replace(/\D/g, "");
  }

  const digits = onlyDigits(text);
  const normalizedDigits = normalizeCepDigits(digits);
  if (normalizedDigits) return normalizedDigits;

  const byWords = wordsToDigits(text);
  return normalizeCepDigits(byWords) || spokenPortugueseCepToDigits(text);
}

function normalizeCepDigits(value: string) {
  const digits = onlyDigits(value);
  if (/^\d{8}$/.test(digits)) return digits;
  // Incomplete CEPs are not silently padded.
  return "";
}

function parseDocument(text: string): { valid: false; type?: never; formatted?: never } | { valid: true; type: "CPF" | "CNPJ"; formatted: string } {
  const digits = onlyDigits(text);
  if (digits.length === 11 && isValidCpf(digits)) {
    return { valid: true, type: "CPF", formatted: digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") };
  }
  if (digits.length === 14 && isValidCnpj(digits)) {
    return { valid: true, type: "CNPJ", formatted: digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") };
  }
  return { valid: false };
}

function isValidCpf(cpf: string) {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(cpf[index]) * (10 - index);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;
  sum = 0;
  for (let index = 0; index < 10; index += 1) sum += Number(cpf[index]) * (11 - index);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

function isValidCnpj(cnpj: string) {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string, factors: number[]) => {
    const sum = factors.reduce((total, factor, index) => total + Number(base[index]) * factor, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = calc(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

function parseBirthDate(text: string) {
  const normalized = normalizeText(text);
  const monthByName: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
  };

  let day = 0;
  let month = 0;
  let year = 0;
  const numbers = onlyDigits(text);
  const separated = text.match(/(\d{1,2})[\/.\-\s](\d{1,2})[\/.\-\s](\d{2,4})/);

  if (separated) {
    day = Number(separated[1]);
    month = Number(separated[2]);
    year = normalizeYear(Number(separated[3]));
  } else if (numbers.length === 6 && /^\d{6}$/.test(text.trim())) {
    day = Number(numbers.slice(0, 2)); month = Number(numbers.slice(2, 4)); year = normalizeYear(Number(numbers.slice(4)));
  } else if (numbers.length === 8) {
    day = Number(numbers.slice(0, 2));
    month = Number(numbers.slice(2, 4));
    year = Number(numbers.slice(4, 8));
  } else {
    const monthName = Object.keys(monthByName).find((name) => normalized.includes(name));
    const parts = normalized.match(/\d+/g)?.map(Number) ?? [];
    if (monthName && parts.length >= 2) {
      day = parts[0];
      month = monthByName[monthName];
      year = normalizeYear(parts[1]);
    }
  }

  if (!day || !month || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getTime() > Date.now()) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 1900 || year > new Date().getFullYear()) return null;
  return date;
}

function normalizeYear(year: number) {
  if (year < 100) return year > 30 ? 1900 + year : 2000 + year;
  return year;
}

function parseSimpleNumber(text: string) {
  const labeled = text.match(/(?:n[uú]mero(?:\s+da\s+(?:casa|resid[eê]ncia))?(?:\s+(?:[eé]|certo))?|\bn(?:[º°.]|(?=\s*\d))|casa)\s*[:=]?\s*(\d{1,6}(?:[a-z]|\s+[a-z](?=\s*$|[,;]))?(?=\s|$|,))/i)?.[1];
  if (labeled) return labeled.replace(/\s/g, "");
  const withComplement = text.trim().match(/^(\d{1,6}[a-z]?)\s*[, -]?\s*(?:ap(?:to|artamento)?\.?\s*\d|casa\b|fundos\b|bloco\b|condom[ií]nio\b)/i);
  if (withComplement) return withComplement[1];
  if (/^(?:s\/?n|sem n[uú]mero)$/i.test(text.trim())) return "S/N";
  if (/^\d{1,6}[a-z]?$/i.test(text.trim())) return text.trim();
  if (/^(?:zero|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove)(?:\s+(?:zero|um|dois|tr[eê]s|quatro|cinco|seis|sete|oito|nove))*$/i.test(text.trim())) return wordsToDigits(text);
  return "";
}

function parseBillingDay(text: string) {
  const digits = onlyDigits(text);
  const spoken = normalizeText(text).match(/\b(vinte e cinco|vinte|quinze|dez|des|oito|cinco)\b/)?.[1];
  const spokenDays: Record<string, number> = { "vinte e cinco": 25, vinte: 20, quinze: 15, dez: 10, des: 10, oito: 8, cinco: 5 };
  const candidates = [Number(digits), spoken ? spokenDays[spoken] : 0, Number(wordsToDigits(text))].filter(Boolean);
  return candidates.find((day) => VALID_BILLING_DAYS.includes(day)) ?? null;
}

function parseEmail(text: string) {
  const match = text.trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = match?.[0].toLowerCase() ?? "";
  return z.string().email().safeParse(email).success ? email : "";
}

function normalizeComplement(text: string) {
  const normalized = text.trim();
  if (!normalized || /^(nao|não|sem|nenhum|n tem|nao tem|não tem)$/i.test(normalized)) {
    return "Sem complemento";
  }
  return normalized;
}

function applyAddress(memory: ChatMemory, address: ViaCepAddress) {
  memory.address = address.street ?? memory.address;
  memory.neighborhood = address.neighborhood ?? memory.neighborhood;
  memory.city = address.city ?? memory.city;
  memory.state = address.state ?? memory.state;
}

async function fetchViaCep(cep: string): Promise<ViaCepAddress | null> {
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (data.erro) return null;
    return {
      street: data.logradouro,
      neighborhood: data.bairro,
      city: data.localidade,
      state: data.uf,
    };
  } catch {
    return null;
  }
}

function formatCep(cep?: string) {
  const digits = onlyDigits(cep ?? "");
  return digits.length === 8 ? digits.replace(/(\d{5})(\d{3})/, "$1-$2") : cep ?? "";
}

function formatDate(date: Date) {
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatAddressShort(memory: ChatMemory) {
  const street = memory.address ? memory.address : "Endereço informado";
  const neighborhood = memory.neighborhood ? `, ${memory.neighborhood}` : "";
  const cityState = memory.city || memory.state ? ` – ${[memory.city, memory.state].filter(Boolean).join("/")}` : "";
  return `${street}${neighborhood}${cityState}`;
}

function formatFullAddress(memory: ChatMemory) {
  const base = [
    memory.address ?? "Rua não informada",
    memory.streetNumber ? `nº ${memory.streetNumber}` : "sem número",
    memory.complement && memory.complement !== "Sem complemento" ? memory.complement : "",
    memory.neighborhood,
  ].filter(Boolean).join(", ");
  const cityState = [memory.city, memory.state].filter(Boolean).join("/");
  return cityState ? `${base} – ${cityState}` : base;
}

function formatAddressForPlanIntro(memory: ChatMemory) {
  const firstLine = [
    memory.address ?? "Rua não informada",
    memory.streetNumber ? `nº ${memory.streetNumber}` : "sem número",
  ].filter(Boolean).join(", ");
  const secondLine = [
    memory.neighborhood,
    memory.city || memory.state ? `${memory.city ?? ""}${memory.city && memory.state ? "/" : ""}${memory.state ?? ""}` : "",
  ].filter(Boolean).join(" – ");
  return secondLine ? `${firstLine}\n ${secondLine}` : firstLine;
}

function buildSummary(memory: ChatMemory) {
  const birthDate = memory.birthDate ? formatDate(new Date(memory.birthDate)) : "Não informado";
  return [
    "Confira sua solicitação:",
    "━━━━━━━━━━━━━━━━━━",
    "🛜 PLANO",
    `${memory.planName ?? "Não informado"}`,
    `💰 ${memory.planValue ? `${formatMoney(memory.planValue)}/mês` : "Não informado"}`,
    "━━━━━━━━━━━━━━━━━━",
    `👤 Nome: ${memory.name ?? "Não informado"}`,
    `👤 Nome da mãe: ${memory.motherName ?? "Não informado"}`,
    `📲 WhatsApp: ${memory.whatsapp ?? "Não informado"}`,
    `🆔 ${memory.documentType ?? "CPF"}: ${memory.cpfCnpj ?? "Não informado"}`,
    `🎂 Nascimento: ${birthDate}`,
    `📧 E-mail: ${memory.email ?? "Não informado"}`,
    `📍 CEP: ${formatCep(memory.cep)}`,
    `🏠 Endereço: ${formatFullAddress(memory)}`,
    `📅 Vencimento: ${memory.billingDueDay ? `Dia ${memory.billingDueDay}` : "Não informado"}`,
    "━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function formatPlanList(plans: PlanCandidate[]) {
  if (!plans.length) return "No momento não há planos ativos cadastrados.";
  const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  return [
    "🛜 PLANOS DE INTERNET FIBRA",
    ...plans.map((plan, index) => {
      const title = `${numberEmojis[index] ?? `${index + 1}.`} ${plan.name} — ${formatMoney(Number(plan.price))}/mês${planListBadge(plan)}`;
      const benefits = plan.description?.split("\n").filter(Boolean).map((line) => `• ${line}`).join("\n");
      return benefits ? `${title}\n${benefits}` : title;
    }),
  ].join("\n\n");
}

function planListBadge(plan: PlanCandidate) {
  const speed = planSpeedMbps(plan);
  if (speed === 500) return " ⭐";
  if (speed === 600) return " 🚀";
  if (speed >= 1000) return " ⚡";
  return "";
}

function buildPlanOptionList(plans: PlanCandidate[]): Extract<InteractivePayload, { type: "option-list" }> {
  return {
    type: "option-list",
    title: "Planos disponíveis",
    message: "Escolha um plano na lista abaixo.",
    buttonLabel: "Ver planos",
    options: plans.map((plan) => ({
      id: plan.id,
      title: limitText(planOptionTitle(plan), 24),
      description: limitText(planOptionDescription(plan), 72),
    })),
  };
}

function findRecommendedPlan(plans: PlanCandidate[], needs = "") {
  const text = normalizeText(needs);
  if (/barat|econom|basico|so (estudar|mensag)/.test(text)) return [...plans].sort((a,b) => Number(a.price) - Number(b.price))[0];
  if (/varios|muitos|jog|home office|trabalh|familia/.test(text)) return [...plans].filter(p => planSpeedMbps(p) >= 800).sort((a,b) => Number(a.price) - Number(b.price))[0] ?? plans[0];

  const preferred =
    plans.find((plan) => normalizeText(plan.name).includes("1 giga") && normalizeText(plan.name).includes("chip")) ??
    plans.find((plan) => normalizeText(plan.name).includes("500 mega") && normalizeText(plan.name).includes("chip"));
  if (preferred) return preferred;

  return plans.reduce<PlanCandidate | undefined>(
    (mostExpensive, plan) =>
      !mostExpensive || Number(plan.price) > Number(mostExpensive.price) ? plan : mostExpensive,
    undefined,
  );
}

function findUpsellCandidate(selectedPlan: PlanCandidate, plans: PlanCandidate[], memory: ChatMemory) {
  const selectedSpeed = planSpeedMbps(selectedPlan);
  if (!selectedSpeed) return null;

  const declined = new Set(memory.declinedUpsellPlanIds ?? []);
  const offered = new Set(memory.offeredUpsellPlanIds ?? []);
  return [...plans].filter(plan => planSpeedMbps(plan) > selectedSpeed && !declined.has(plan.id) && !offered.has(plan.id))
    .sort((a, b) => planSpeedMbps(a) - planSpeedMbps(b))[0] ?? null;
}

function upsellMessage(selectedPlan: PlanCandidate, upsellPlan: PlanCandidate) {
  const difference = Number(upsellPlan.price) - Number(selectedPlan.price);
  const selectedSpeed = planSpeedMbps(selectedPlan);
  const upsellSpeed = planSpeedMbps(upsellPlan);
  const selectedPrice = formatMoney(Number(selectedPlan.price));
  const upsellPrice = formatMoney(Number(upsellPlan.price));

  if (selectedSpeed === 200 && upsellSpeed === 350) {
    return [
      "Antes de continuarmos, tenho uma opção que vale a pena você conhecer. 😊",
      `Hoje o plano de ${upsellPlan.name} custa ${upsellPrice}/mês, enquanto o de ${selectedPlan.name} custa ${selectedPrice}.`,
      "Ou seja:",
      `1️⃣ ${selectedPlan.name} — ${selectedPrice}/mês`,
      `2️⃣ ${upsellPlan.name} — ${upsellPrice}/mês 🚀`,
      "Você leva mais velocidade e ainda paga alguns centavos a menos.",
      `Quer aproveitar os ${upsellPlan.name} por ${upsellPrice} ou prefere continuar com os ${selectedPlan.name}?`,
    ].join("\n");
  }

  return [
    "Boa escolha! 😊",
    "Antes de continuarmos, deixa eu te mostrar uma opção que pode compensar bastante:",
    "",
    `🔹 ${selectedPlan.name} — ${selectedPrice}/mês`,
    `⭐ ${upsellPlan.name} — ${upsellPrice}/mês`,
    "",
    difference > 0
      ? `A diferença é de ${formatMoney(difference)} por mês e você leva mais ${upsellSpeed - selectedSpeed} Mega de velocidade.`
      : `Você leva mais ${upsellSpeed - selectedSpeed} Mega de velocidade com mensalidade igual ou menor.`,
    upsellPlan.description ? `Benefícios do ${upsellPlan.name}:\n${upsellPlan.description}` : "",
    `Quer manter os ${selectedPlan.name} ou prefere aproveitar os ${upsellPlan.name} por ${upsellPrice}?`,
  ].join("\n");
}

function planSpeedMbps(plan: PlanCandidate) {
  const normalized = normalizeText(`${plan.name} ${plan.speed}`);
  const gigaMatch = normalized.match(/(\d+(?:\s|)?)\s*giga/);
  if (gigaMatch) return Number(gigaMatch[1].trim() || 1) * 1000;
  const megaMatch = normalized.match(/(\d+)\s*mega/);
  if (megaMatch) return Number(megaMatch[1]);
  return 0;
}

function addressFoundMessage(memory: ChatMemory) {
  return [
    "Perfeito! 😊 Localizei o endereço:",
    `📍 ${formatAddressShort(memory)}`,
    "",
    "Agora só preciso completar o endereço.",
    "Qual é o número da residência? 🏠",
  ].join("\n");
}

function costBenefitHint(plans: PlanCandidate[]) {
  const has500 = plans.some((plan) => planSpeedMbps(plan) === 500);
  const has600 = plans.some((plan) => planSpeedMbps(plan) === 600);
  if (has500 && has600) {
    return "Se você estiver procurando custo-benefício, eu daria uma atenção especial aos planos de 500 e 600 Mega. 😉";
  }
  return "Se você estiver procurando custo-benefício, eu daria uma atenção especial aos planos com melhor velocidade pelo menor valor. 😉";
}

function nextCustomerDataResponse(memory: ChatMemory, prefix = ""): NextBotResponse {
  if (!memory.name || !fullName(memory.name)) {
    return {
      state: "ASK_NAME",
      memory,
      reply: `${prefix}Qual é o seu nome completo, por favor? 👤`,
    };
  }

  if (!memory.motherName || !fullName(memory.motherName)) {
    return { state: "ASK_MOTHER_NAME", memory, reply: `${prefix}Qual é o nome completo da sua mãe, por favor? 👤` };
  }

  if (!memory.cpfCnpj || !parseDocument(memory.cpfCnpj).valid) {
    return {
      state: "ASK_DOCUMENT",
      memory,
      reply: `${prefix}Agora preciso de uma informação necessária para seguirmos com a solicitação e análise do cadastro.\n🔐 Me informe o seu CPF, por favor.`,
    };
  }

  if (!memory.birthDate || Number.isNaN(new Date(memory.birthDate).getTime()) || new Date(memory.birthDate).getTime() > Date.now()) {
    return {
      state: "ASK_BIRTH_DATE",
      memory,
      reply: `${prefix}📅 Agora preciso da sua data de nascimento.\nPode me informar no formato DD/MM/AAAA?`,
    };
  }

  if (!memory.email || (!memory.emailCollected && !parseEmail(memory.email))) {
    return {
      state: "ASK_EMAIL",
      memory,
      reply: `${prefix}📧 Agora me informe o seu e-mail, por favor.`,
    };
  }

  if (!memory.billingDueDay || !VALID_BILLING_DAYS.includes(memory.billingDueDay)) {
    return {
      state: "ASK_BILLING_DUE_DAY",
      memory,
      reply: `${prefix}${billingDueDayPrompt()}`,
    };
  }

  return {
    state: "CONFIRM_DATA",
    memory,
    reply: `${prefix}${buildSummary(memory)}\n\nEstá tudo correto? 😊\n👉 Digite *SIM* para confirmar sua solicitação.\nCaso alguma informação esteja incorreta, responda *NÃO* que eu te ajudo a corrigir.`,
  };
}

function selectedPlanMessage(plan: PlanCandidate) {
  const speed = planSpeedMbps(plan);
  const price = formatMoney(Number(plan.price));

  if (speed === 350) {
    return `Ótima escolha! 😊🛜\nEntão ficou:\n🚀 ${plan.name}\n💰 ${price}/mês\n\nÉ uma ótima opção para quem busca uma boa velocidade sem aumentar o valor mensal.\nAgora vou iniciar seus dados para seguirmos com a solicitação. ✅\n`;
  }

  if (speed === 500) {
    return `Ótima escolha! ⭐😊\nVocê escolheu:\n🛜 ${plan.name}\n💰 ${price}/mês\n\nÉ uma das opções com melhor custo-benefício para quem utiliza vários aparelhos conectados no dia a dia. 📱📺💻\nAgora vou iniciar seus dados para seguirmos com a solicitação. ✅\n`;
  }

  if (speed === 600) {
    return `Excelente escolha! 🚀\nVocê escolheu:\n🛜 ${plan.name}\n💰 ${price}/mês\n\nUma ótima opção para quem busca bastante velocidade e utiliza vários dispositivos conectados. ⚡\nAgora vou iniciar seus dados para seguirmos com a solicitação. ✅\n`;
  }

  if (speed >= 1000) {
    return `Excelente escolha! ⚡🔥\nVocê escolheu:\n🛜 ${plan.name}\n💰 ${price}/mês\n\nÉ a opção para quem procura bastante velocidade e desempenho para vários dispositivos conectados. 🚀\nAgora vou iniciar seus dados para seguirmos com a solicitação. ✅\n`;
  }

  return `Ótima escolha! 😊🛜\nEntão ficou:\n🚀 ${plan.name}\n💰 ${price}/mês\n\nAgora vou iniciar seus dados para seguirmos com a solicitação. ✅\n`;
}

function selectPlan(text: string, plans: PlanCandidate[]) {
  const normalized = normalizeText(text);

  const byId = plans.find((plan) => normalized.includes(normalizeText(plan.id)));
  if (byId) return byId;

  // A shared speed must not select the base plan when a named benefit was requested.
  if (normalized.includes("disney") && !/\b(?:sem|nao(?: quero)?)\s+(?:o\s+)?disney/.test(normalized)) {
    return plans.find(plan => normalizeText(plan.name).includes("disney")) ?? null;
  }
  const fullName = [...plans].sort((a, b) => b.name.length - a.name.length)
    .find(plan => normalized.includes(normalizeText(plan.name)));
  if (fullName) return fullName;

  const byName = plans.find((plan) => {
    const name = normalizeText(plan.name);
    const speed = normalizeText(plan.speed);
    const shortTitle = normalizeText(planOptionTitle(plan));
    const description = normalizeText(planOptionDescription(plan));
    return normalized.includes(name) || normalized.includes(speed) || normalized.includes(shortTitle) || normalized.includes(description);
  });
  if (byName) return byName;

  const aliases = [
    { terms: ["200", "duzentos"], chip: false },
    { terms: ["350", "trezentos e cinquenta"], chip: false },
    { terms: ["400", "quatrocentos"], chip: false },
    { terms: ["500", "quinhentos"], chip: false },
    { terms: ["600", "seiscentos"], chip: false },
    { terms: ["700", "setecentos"], chip: false },
    { terms: ["800", "oitocentos"], chip: false },
    { terms: ["1gb", "1 giga", "um giga", "1000"], chip: false },
  ];
  const wantsChip = normalized.includes("chip") || normalized.includes("celular") || normalized.includes("35gb");
  const alias = aliases.find((item) => item.chip === wantsChip && item.terms.some((term) => normalized.includes(term)));
  if (alias) {
    return plans.find((plan) => {
      const planName = normalizeText(`${plan.name} ${plan.speed}`);
      const hasSpeed = alias.terms.some((term) => planName.includes(normalizeText(term)));
      const hasChip = planName.includes("chip") || planName.includes("35gb");
      return hasSpeed && hasChip === alias.chip;
    });
  }

  const mentionedPrices = [...text.matchAll(/(?:r\$\s*|\b(?:de|por|valor|prefiro|preferia)\s+(?:(?:o|a|de)\s+)*)(\d{2,4}(?:[,.]\d{1,2})?)(?!\d)/gi)].map(match => Number(match[1].replace(",", ".")));
  const pricedPlans = plans.filter(plan => mentionedPrices.includes(Number(plan.price)));
  if (pricedPlans.length === 1) return pricedPlans[0];
  const priceText = text.toLowerCase().trim().replace(/^(?:o )?(?:plano|opcao|internet)?\s*(?:de|por)?\s*(?:r\$)?\s*/, "").replace(/\s*(?:reais|por mes|mensais|mes)$/, "").trim();
  if (/^\d{2,4}(?:[,.]\d{1,2})?$/.test(priceText)) {
    const price = Number(priceText.replace(",", "."));
    const matching = plans.filter(plan => Number(plan.price) === price);
    if (matching.length === 1) return matching[0];
  }

  const numericChoice = Number(normalized.match(/\b\d+\b/)?.[0]);
  if (numericChoice >= 1 && numericChoice <= plans.length && !normalized.includes("gb")) {
    return plans[numericChoice - 1];
  }

  return null;
}

function applyParsedCustomerData(memory: ChatMemory, text: string, state: string) {
  const document = parseDocument(text);
  const labeledDoc = text.match(/(?:cpf|cnpj)\s*[:=]?\s*([\d.\-/]+)/i)?.[1];
  const doc = labeledDoc ? parseDocument(labeledDoc) : document;
  if (doc.valid) { memory.cpfCnpj = doc.formatted; memory.documentType = doc.type; }
  const dateSource = text.match(/\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/)?.[0];
  const birthDate = dateSource ? parseBirthDate(dateSource) : state === "ASK_BIRTH_DATE" ? parseBirthDate(text) : null;
  if (birthDate) memory.birthDate = birthDate.toISOString();
  const cep = state === "ASK_CEP" ? parseCep(text) : text.match(/\bcep\s*[:=]?\s*(\d{5}[- ]?\d{3})\b/i)?.[1];
  if (cep) memory.cep = onlyDigits(cep);
  const email = parseEmail(text); if (email) memory.email = email;
  const complement = text.match(/complemento\s*[:=]?\s*([^;\n,]+)/i)?.[1];
  if (complement && complement.length < 160) memory.complement = normalizeComplement(complement.trim());
  const billingSource = text.match(/(?:vencimento|vencer|dia)\s*[:=]?\s*(\d{1,2})\b/i)?.[1];
  const billing = state === "ASK_BILLING_DUE_DAY" ? parseBillingDay(text) : billingSource ? parseBillingDay(billingSource) : null;
  if (billing) memory.billingDueDay = billing;
  const motherName = extractMotherName(text) || (state === "ASK_MOTHER_NAME" ? fullName(text) : "");
  if (motherName) memory.motherName = motherName;
  const name = state === "ASK_MOTHER_NAME" || extractMotherName(text) ? "" : extractLabeledName(text) || (state === "ASK_NAME" ? fullName(text) : "");
  if (name) memory.name = name;
  const number = text.match(/(?:n[uú]mero|n[º°])\s*[:=]?\s*(\d{1,6}(?:[a-z]|\s+[a-z](?=\s*$|[,;]))?)/i)?.[1];
  if (number) memory.streetNumber = number.replace(/\s/g, "");
}

function shouldParseCepForState(text: string, state: string, birthDate: Date | null) {
  if (birthDate) return false;
  if (state === "ASK_CEP" || state === "ASK_ADDRESS_CONFIRM") return true;
  if (state === "CORRECTION") {
    const normalized = normalizeText(text);
    return /\bcep\b|endere[cç]o|logradouro|rua|avenida|av\b/.test(normalized);
  }
  return false;
}

function extractNameFromText(text: string) {
  const withoutKnownData = text
    .replace(/\b\d{5}-?\d{3}\b/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b\d{1,2}[\/.\-\s]\d{1,2}[\/.\-\s]\d{2,4}\b/g, " ")
    .replace(/\b\d[\d.\-/\s]{9,}\d\b/g, " ")
    .replace(/\b(meu nome e|meu nome é|nome|sou|eu sou)\b/gi, " ")
    .trim();
  const words = withoutKnownData.split(/\s+/).filter((word) => /^[A-Za-zÀ-ÿ]{2,}$/.test(word));
  if (words.length < 2 || words.length > 5) return "";
  return toTitleCase(words.join(" "));
}

function hasExplicitNameMarker(text: string) {
  return /\b(meu nome e|meu nome é|nome|sou|eu sou)\b/i.test(text);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsToDigits(value: string) {
  const digitWords: Record<string, string> = {
    zero: "0",
    um: "1",
    uma: "1",
    dois: "2",
    duas: "2",
    tres: "3",
    quatro: "4",
    cinco: "5",
    seis: "6",
    meia: "6",
    sete: "7",
    oito: "8",
    nove: "9",
  };
  return normalizeText(value)
    .split(" ")
    .map((word) => digitWords[word] ?? "")
    .join("");
}

function spokenPortugueseCepToDigits(value: string) {
  const tokens = normalizeText(value)
    .split(" ")
    .filter((token) => token && token !== "e" && token !== "cep");
  const pieces: string[] = [];

  for (let index = 0; index < tokens.length;) {
    const singleDigit = spokenDigit(tokens[index]);
    if (singleDigit !== null) {
      pieces.push(singleDigit);
      index += 1;
      continue;
    }

    let matched = false;
    for (let size = Math.min(5, tokens.length - index); size >= 1; size -= 1) {
      const phrase = tokens.slice(index, index + size);
      const parsed = parsePortugueseNumber(phrase);
      if (!parsed) continue;

      pieces.push(String(parsed.value).padStart(parsed.width, "0"));
      index += size;
      matched = true;
      break;
    }

    if (!matched) index += 1;
  }

  return normalizeCepDigits(pieces.join(""));
}

function spokenDigit(word: string) {
  const digits: Record<string, string> = {
    zero: "0",
    um: "1",
    uma: "1",
    dois: "2",
    duas: "2",
    tres: "3",
    quatro: "4",
    cinco: "5",
    seis: "6",
    meia: "6",
    sete: "7",
    oito: "8",
    nove: "9",
  };
  return digits[word] ?? null;
}

function parsePortugueseNumber(tokens: string[]) {
  const units: Record<string, number> = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
  };
  const teens: Record<string, number> = {
    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,
    catorze: 14,
    quatorze: 14,
    quinze: 15,
    dezesseis: 16,
    dezasseis: 16,
    dezessete: 17,
    dezassete: 17,
    dezoito: 18,
    dezenove: 19,
    dezanove: 19,
  };
  const tens: Record<string, number> = {
    vinte: 20,
    trinta: 30,
    quarenta: 40,
    cinquenta: 50,
    sessenta: 60,
    setenta: 70,
    oitenta: 80,
    noventa: 90,
  };
  const hundreds: Record<string, number> = {
    cem: 100,
    cento: 100,
    duzentos: 200,
    trezentos: 300,
    quatrocentos: 400,
    quinhentos: 500,
    seiscentos: 600,
    setecentos: 700,
    oitocentos: 800,
    novecentos: 900,
  };

  let total = 0;
  let hasHundred = false;
  let hasTen = false;
  let hasUnit = false;
  let hundredCount = 0;
  let tenCount = 0;
  let teenCount = 0;
  let unitCount = 0;

  for (const token of tokens.filter((item) => item !== "e")) {
    if (hundreds[token]) {
      hundredCount += 1;
      if (hundredCount > 1) return null;
      total += hundreds[token];
      hasHundred = true;
      continue;
    }
    if (teens[token]) {
      teenCount += 1;
      if (teenCount > 1 || tenCount > 0 || unitCount > 0) return null;
      total += teens[token];
      hasTen = true;
      continue;
    }
    if (tens[token]) {
      tenCount += 1;
      if (tenCount > 1 || teenCount > 0) return null;
      total += tens[token];
      hasTen = true;
      continue;
    }
    if (units[token]) {
      unitCount += 1;
      if (unitCount > 1 || teenCount > 0) return null;
      total += units[token];
      hasUnit = true;
      continue;
    }
    return null;
  }

  if (!total) return null;
  if (hasHundred) return { value: total, width: 3 };
  if (hasTen) return { value: total, width: 2 };
  if (hasUnit) return { value: total, width: 1 };
  return null;
}

function isHandoffRequest(text: string) {
  const normalized = normalizeText(text);
  if (/nao (quero|preciso).*atendente|nao.*humano/.test(normalized)) return false;
  return ["atendente", "humano", "consultor", "vendedor", "falar com alguem", "falar com uma pessoa"].some((term) => normalized.includes(term));
}

function isRestartRequest(text: string) {
  const normalized = normalizeText(text);
  return ["reiniciar", "recomecar", "comecar de novo", "novo atendimento", "outra consulta"].some((term) => normalized.includes(term));
}

function shouldAnswerOutsideFlow(text: string, state: string) {
  if (["START", "CONFIRM_DATA", "CORRECTION", "FINISHED", "FINISHED_UNAVAILABLE", "HUMAN_HANDOFF"].includes(state)) return false;
  return looksLikeQuestion(text) && !parseEmail(text) && !parseCep(text) && !parseBillingDay(text);
}

function looksLikeQuestion(text: string) {
  const normalized = normalizeText(text);
  return text.includes("?") || /^(como|qual|quais|quanto|quando|onde|por que|porque|tem|voce|voces|pode|posso)\b/.test(normalized);
}

function asksWhyCpf(text: string) {
  const normalized = normalizeText(text);
  return normalized.includes("cpf") && /por que|porque|pra que|para que|precisa/.test(normalized);
}

function promptForState(state: string, firstName?: string) {
  const name = firstName ? `${firstName}, ` : "";
  const prompts: Record<string, string> = {
    ASK_CEP: "Para começar, pode me informar o CEP da instalação, por favor? 📍",
    ASK_STREET_NUMBER: "Me informe o número da residência.",
    ASK_COMPLEMENT: "Agora me informe se há complemento para o endereço.",
    ASK_ADDRESS_CONFIRM: "Agora me informe seu nome completo, por gentileza.",
    ASK_NAME: "Agora me informe seu nome completo, por gentileza.",
    ASK_MOTHER_NAME: "Agora me informe o nome completo da sua mãe, por gentileza.",
    ASK_DOCUMENT: `${name}me informe seu CPF, por favor.`,
    ASK_BIRTH_DATE: "Agora me informe sua data de nascimento no formato DD/MM/AAAA, por favor.",
    ASK_BILLING_DUE_DAY: "Qual vencimento você prefere: 5, 8, 10, 15, 20 ou 25?",
    ASK_EMAIL: "Agora preciso do seu e-mail, por favor.",
    CHOOSE_PLAN: "Qual plano você gostaria de escolher?",
  };
  return prompts[state] ?? "Me envie a próxima informação para continuarmos.";
}

function callResumePrompt(
  state: string,
  memory: ChatMemory,
  agent: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>,
) {
  if (state === "START") {
    return greetingMessage(agent?.name);
  }
  if (state === "FINISHED") return "";
  if (state === "HUMAN_HANDOFF") return "Seu atendimento está sinalizado para uma consultora humana continuar por aqui.";
  return promptForState(state, getFirstName(memory.name));
}

function extractedValueForState(state: string, data?: ExtractedCustomerData) {
  if (!data) return undefined;
  const values: Record<string, string | undefined> = {
    ASK_CEP: data.cep,
    ASK_STREET_NUMBER: data.streetNumber ?? parseStreetNumberFromAddress(data.address),
    ASK_NAME: data.fullName,
    ASK_MOTHER_NAME: data.motherName,
    ASK_DOCUMENT: data.cpf,
    ASK_BIRTH_DATE: data.birthDate,
    ASK_EMAIL: data.email,
  };
  return values[state];
}

function parseStreetNumberFromAddress(address?: string) {
  if (!address) return "";
  const match = address.match(/\b(\d{1,6})\b/);
  return match?.[1] ?? "";
}

function hasUsefulExtractedDataForState(state: string, data?: ExtractedCustomerData) {
  return Boolean(extractedValueForState(state, data));
}

function applyExtractedAddress(memory: ChatMemory, data?: ExtractedCustomerData) {
  if (!data) return;
  applyAddress(memory, {
    street: data.address,
    neighborhood: data.neighborhood,
    city: data.city,
    state: data.state,
  });
  if (!memory.streetNumber) {
    memory.streetNumber = data.streetNumber ?? parseStreetNumberFromAddress(data.address) ?? memory.streetNumber;
  }
}

function mediaFallbackReply(state: string, firstName?: string) {
  const replies: Record<string, string> = {
    ASK_CEP: "Recebi o comprovante, mas não consegui identificar o CEP com segurança. Pode me enviar o CEP digitado, por favor? 😊",
    ASK_STREET_NUMBER: "Recebi o comprovante, mas não consegui identificar com segurança o número da residência. Pode me enviar só o número, por favor? 😊",
    ASK_MOTHER_NAME: "Recebi o documento, mas não consegui confirmar com segurança o nome da sua mãe. Pode me escrever o nome completo dela, por favor? 😊",
    ASK_NAME: "Recebi o documento, mas não consegui confirmar com segurança o nome completo. Pode me escrever seu nome, por favor? 😊",
    ASK_DOCUMENT: "Recebi o documento, mas não consegui confirmar com segurança o CPF ou CNPJ. Pode me enviar digitado, por favor? 😊",
    ASK_BIRTH_DATE: "Recebi o documento, mas não consegui confirmar com segurança a data de nascimento. Pode me enviar no formato 26/01/1998, por favor? 😊",
    ASK_EMAIL: "Recebi o arquivo, mas não consegui identificar o e-mail com segurança. Pode me enviar digitado, por favor? 😊",
  };
  return replies[state] ?? `Recebi o arquivo, mas não consegui identificar com segurança o dado necessário.\n\n${promptForState(state, firstName)}`;
}

function parseCorrectionField(text: string): CorrectionField | undefined {
  const normalized = normalizeText(text);
  if (normalized === "8" || /\bmae\b/.test(normalized)) return "motherName";
  if (normalized === "1" || normalized.includes("nome")) return "name";
  if (normalized === "2" || normalized.includes("cpf") || normalized.includes("documento")) return "document";
  if (normalized === "3" || normalized.includes("nascimento") || normalized.includes("data")) return "birthDate";
  if (normalized === "4" || normalized.includes("email") || normalized.includes("e mail")) return "email";
  if (/telefone|celular|whatsapp/.test(normalized)) return undefined;
  if (normalized === "5" || normalized.includes("endereco") || normalized.includes("cep") || normalized.includes("numero")) return "address";
  if (normalized === "6" || normalized.includes("vencimento") || normalized.includes("fatura")) return "billing";
  if (normalized === "7" || normalized.includes("plano")) return "plan";
  return undefined;
}

function isCorrectionChoiceOnly(text: string) {
  const normalized = normalizeText(text);
  return /^[1-8]$/.test(normalized) || [
    "nome da mae", "mae", "nome", "cpf", "documento", "data de nascimento", "nascimento", "email", "e mail", "endereco", "cep", "vencimento", "plano",
  ].includes(normalized);
}

function correctionPrompt(field: CorrectionField) {
  const prompts: Record<CorrectionField, string> = {
    name: "Certo 😊 Me informe o nome completo correto.",
    motherName: "Certo 😊 Me informe o nome completo da sua mãe.",
    document: "Certo 😊 Me informe o CPF correto.",
    birthDate: "Certo 😊 Me informe a data de nascimento correta no formato DD/MM/AAAA.",
    email: "Certo 😊 Me informe o e-mail correto.",
    address: "Certo 😊 Me informe o endereço correto. Pode enviar CEP, número e complemento.",
    billing: "Certo 😊 Qual vencimento você prefere: 5, 8, 10, 15, 20 ou 25?",
    plan: "Certo 😊 Qual plano você quer escolher?",
  };
  return prompts[field];
}

function asksForPlanList(text: string) {
  const normalized = normalizeText(text);
  return ["ver os planos", "quero ver", "opcoes", "opcoes disponiveis", "quais planos", "outros planos"].some((term) => normalized.includes(term)) || /(?:manda|mande|envia|envie|mostra|mostre|reenvi).{0,25}(?:planos|opcoes|valores)/.test(normalized);
}

function asksForPlanRecommendation(text: string) {
  const normalized = normalizeText(text);
  const mentionsPlan = /\b(plano|internet|fibra|mega|giga|velocidade)\b/.test(normalized);
  const requestsRecommendation = [
    "melhor", "recomenda", "recomende", "recomendacao", "indica", "indique", "ideal",
    "para jogar", "para jogos", "para trabalhar", "para estudar", "mais rapido", "mais completa",
  ].some((term) => normalized.includes(term));
  return mentionsPlan && requestsRecommendation;
}

function isPlanQuestion(text: string) {
  const normalized = normalizeText(text);
  return /\b(plano|planos|internet|fibra|mega|megas|giga|chip)\b/.test(normalized) && looksLikeQuestion(text);
}

function isAlternativeRequest(text: string) {
  const normalized = normalizeText(text);
  return ["outro", "outra", "outra opcao", "outra opção", "prefiro outro"].some((term) => normalized.includes(normalizeText(term)));
}

function isPositive(text: string) { return isExplicitConfirmation(text); }
function isNegative(text: string) { return /^(nao (esta|ta|ficou) (correto|certo)|esta errado|tem erro)/.test(normalizeText(text)) || isExplicitRefusal(text) || /^(corrigir|alterar|mudar|errado)(?:\s|$)/.test(normalizeText(text)); }

function isPlanRefusal(text: string) {
  const normalized = normalizeText(text);
  return ["nao quero", "nao gostei", "nao tenho interesse", "muito caro", "ta caro", "esta caro", "vou pensar", "deixa pra la", "nenhum plano", "nao vou contratar"].some((term) => normalized.includes(term));
}

function getFirstName(name?: string) {
  return name?.split(" ").filter(Boolean)[0] ?? "";
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function limitText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function planOptionTitle(plan: PlanCandidate) {
  return plan.name;
}

function planOptionDescription(plan: PlanCandidate) {
  const details = [];
  if (plan.description) details.push(plan.description.replace(/\s+/g, " ").trim());
  details.push(`${formatMoney(Number(plan.price))}/mês`);
  return details.join(" - ");
}

function interpolate(template: string, memory: ChatMemory, agentName?: string) {
  return template
    .replaceAll("{{agente}}", agentName || "Lily")
    .replaceAll("{{nome}}", getFirstName(memory.name) || "cliente")
    .replaceAll("{{cep}}", formatCep(memory.cep))
    .replaceAll("{{endereco}}", formatFullAddress(memory));
}

function greetingMessage(agentName?: string) {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );

  const greeting =
    hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";

  return `Olá, ${greeting}! 😊 Tudo bem?\nEu sou a ${agentName ?? "Lily"}, consultora de planos de internet fibra. 💙\nVou iniciar o seu atendimento, tudo bem? O primeiro passo é eu verificar se tem disponibilidade para sua casa. 🛜✨\n\nPara começar, pode me informar o CEP da instalação, por favor? 📍`;
}

function agentConfig(agent: Awaited<ReturnType<ChatbotRepository["getAgentByInstance"]>>) {
  if (!agent) return undefined;
  return {
    baseUrl: agent.zapiBaseUrl ?? undefined,
    instanceId: agent.zapiInstanceId ?? undefined,
    token: agent.zapiToken ?? undefined,
    clientToken: agent.zapiClientToken ?? undefined,
    whatsappNumber: agent.zapiWhatsappNumber ?? undefined,
  };
}

function flowMessage(flow: unknown, state: string, fallback: string) {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) return fallback;
  const steps = (flow as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return fallback;
  const step = steps.find((item) => item && typeof item === "object" && (item as { state?: string }).state === state);
  const message = step && typeof step === "object" ? (step as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function formatAgentRules(rules: unknown) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return "Nenhuma regra adicional configurada.";
  return Object.entries(rules).filter(([key]) => key !== "coveragePolicy").map(([, value]) => value)
    .filter((value) => value !== false && value !== null && value !== undefined)
    .map((value) => `- ${String(value)}`)
    .join("\n") || "Nenhuma regra adicional configurada.";
}

function applyValidatedExtractedData(memory: ChatMemory, data: ExtractedCustomerData) {
  if (data.motherName && fullName(data.motherName)) memory.motherName = fullName(data.motherName);
  if (data.fullName && fullName(data.fullName)) memory.name = fullName(data.fullName);
  if (data.cep && /^\d{8}$/.test(onlyDigits(data.cep))) memory.cep = onlyDigits(data.cep);
  if (data.cpf) {
    const doc = parseDocument(data.cpf);
    if (doc.valid) { memory.cpfCnpj = doc.formatted; memory.documentType = doc.type; }
  }
  const birth = data.birthDate ? parseBirthDate(data.birthDate) : null;
  if (birth) memory.birthDate = birth.toISOString();
  if (data.email && parseEmail(data.email) === data.email.toLowerCase().trim()) memory.email = parseEmail(data.email);
  if (data.streetNumber && parseSimpleNumber(data.streetNumber)) memory.streetNumber = parseSimpleNumber(data.streetNumber);
  applyExtractedAddress(memory, data);
}

function conflictingFields(text: string, acceptEmailAnswer = false) {
  const emails = [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])];
  if (emails.length > 1 && !acceptEmailAnswer) return "Recebi dois e-mails diferentes. Qual deles devo usar?";
  const ceps = [...new Set([...text.matchAll(/\bcep\s*[:=]?\s*(\d{5}[- ]?\d{3})\b/gi)].map(m => onlyDigits(m[1])))];
  if (ceps.length > 1) return "Recebi dois CEPs diferentes. Qual é o CEP da instalação?";
  if (!text.includes("?") && /quero|prefiro/.test(normalizeText(text)) && /\b600\b/.test(text) && /\b800\b/.test(text)) return "Você mencionou dois planos. Prefere 600 MEGA ou 800 MEGA?";
}

function validCorrection(field: CorrectionField, text: string, plans: PlanCandidate[]) {
  switch (field) {
    case "name": return Boolean(fullName(text));
    case "motherName": return Boolean(extractMotherName(text) || fullName(text));
    case "document": return parseDocument(text).valid;
    case "birthDate": return Boolean(parseBirthDate(text));
    case "email": return isEmailAnswer(text);
    case "address": return Boolean(parseCep(text) || parseSimpleNumber(text) || hasManualAddress(text));
    case "billing": return Boolean(parseBillingDay(text));
    case "plan": return Boolean(selectPlan(text, plans));
  }
}

function afterKnownAddress(memory: ChatMemory, plans: PlanCandidate[]): NextBotResponse {
  if (!memory.streetNumber) return { state: "ASK_STREET_NUMBER", memory, reply: promptForState("ASK_STREET_NUMBER") };
  if (memory.complement === undefined) return { state: "ASK_COMPLEMENT", memory, reply: "O endereço tem complemento? Se não tiver, responda Não." };
  if (!memory.planId) return { state: "CHOOSE_PLAN", memory, reply: `${formatPlanList(plans)}\n\nQual plano prefere?` };
  return nextCustomerDataResponse(memory, `Plano escolhido: ${memory.planName} por ${formatMoney(memory.planValue ?? 0)}/mês.\n\n`);
}

function applyBatchData(memory: ChatMemory, parts: string[], state: string, plans: PlanCandidate[]) {
  let cursor = state;
  for (const part of parts) {
    applyParsedCustomerData(memory, part, cursor);
    if (["START", "ASK_CEP"].includes(cursor)) {
      const cep = parseCep(part);
      if (cep) { memory.cep = cep; cursor = "ASK_STREET_NUMBER"; }
    } else if (cursor === "ASK_STREET_NUMBER") {
      const number = parseSimpleNumber(part);
      if (number) { memory.streetNumber = number; cursor = "ASK_COMPLEMENT"; }
    } else if (cursor === "ASK_COMPLEMENT" && !looksLikeQuestion(part) && !parseEmail(part) && !parseDocument(part).valid) {
      memory.complement = normalizeComplement(part); cursor = "CHOOSE_PLAN";
    } else if (cursor === "CHOOSE_PLAN") {
      const plan = selectPlan(part, plans);
      if (plan) { memory.planId = plan.id; memory.planName = plan.name; memory.planValue = Number(plan.price); cursor = "ASK_NAME"; }
    } else if (cursor === "ASK_NAME" && memory.name) cursor = memory.motherName ? "ASK_DOCUMENT" : "ASK_MOTHER_NAME";
    else if (cursor === "ASK_MOTHER_NAME" && memory.motherName) cursor = "ASK_DOCUMENT";
    else if (cursor === "ASK_DOCUMENT" && memory.cpfCnpj) cursor = "ASK_BIRTH_DATE";
    else if (cursor === "ASK_BIRTH_DATE" && memory.birthDate) cursor = "ASK_EMAIL";
    else if (cursor === "ASK_EMAIL" && memory.email) cursor = "ASK_BILLING_DUE_DAY";
  }
}

/** Fixed-flow inputs must not wait for model classification or a settings lookup. */
function needsConversationalInterpretation(text: string, state: string, memory: ChatMemory, plans: PlanCandidate[]) {
  const value = text.trim();
  if (state === "ASK_EMAIL" && isEmailAnswer(value)) return false;
  if (value.length <= 3 || hasInjection(value)) return false;
  if (officialAnswer(value) || isRestartRequest(value) || isHandoffRequest(value) || asksForPlanRecommendation(value) || asksForPlanList(value)) return false;
  if (looksLikeQuestion(value)) return true;
  if (/^(oi|ola|bom dia|boa tarde|boa noite|tudo bem)[.!\s]*$/.test(normalizeText(value))) return false;
  if (isExplicitConfirmation(value) || isExplicitRefusal(value)) return false;
  if (state === "ASK_CEP" && parseCep(value)) return false;
  if (state === "ASK_STREET_NUMBER" && parseSimpleNumber(value)) return false;
  if (state === "CHOOSE_PLAN" && selectPlan(value, plans)) return false;
  if (state === "ASK_NAME" && fullName(value)) return false;
  if (state === "ASK_MOTHER_NAME" && (extractMotherName(value) || fullName(value))) return false;
  if (state === "ASK_DOCUMENT" && (parseDocument(value).valid || /^[\d.\-/\s]+$/.test(value))) return false;
  if (state === "ASK_BIRTH_DATE" && (parseBirthDate(value) || /^[\d/.\-\s]+$/.test(value))) return false;
  if (state === "ASK_EMAIL" && (parseEmail(value) || value.includes("@"))) return false;
  if (state === "ASK_BILLING_DUE_DAY" && parseBillingDay(value)) return false;
  if (state === "CORRECTION" && (isCorrectionChoiceOnly(value) || (memory.correctionField && validCorrection(memory.correctionField, value, plans)))) return false;
  return true;
}

function billingDueDayPrompt() {
  return "Agora falta escolher o melhor dia para o vencimento da sua fatura. 💳\n📅 Você pode escolher:\n05 • 08 • 10 • 15 • 20 • 25\n\nQual dia fica melhor para você?";
}

function isEmailAnswer(value: string) {
  const text = value.trim(), normalized = normalizeText(text);
  if (!text || hasInjection(text) || isRestartRequest(text) || isHandoffRequest(text) || officialAnswer(text)) return false;
  if (asksForPlanRecommendation(text) || asksForPlanList(text) || isPlanQuestion(text)) return false;
  if (/nao (sei|tenho|lembro|consigo)|esqueci|sem e-?mail/.test(normalized)) return true;
  if (/voltei|continuar|onde paramos|retomar|irritad|chatead|que saco|muita pergunta|perguntas demais|reclam|demorad/.test(normalized)) return false;
  return !looksLikeQuestion(text) || /^\?+$/.test(text) || /e-?mail|gmail|hotmail|outlook|arroba/.test(normalized);
}

function extractMotherName(text: string) {
  const match = text.match(/(?:nome\s+(?:completo\s+)?(?:da|de)\s+(?:minha\s+)?m[aã]e\s*[:=]?|minha\s+m[aã]e\s+(?:se chama|[eé])|m[aã]e\s*[:=])\s*([^;\n]+)/i);
  return match ? fullName(match[1]) : "";
}

function wantsOriginalPlan(text: string) {
  return /^(?:(?:quero|prefiro|vou|pode|continuo com a opcao)\s+)?(?:manter|mantwr|mantes|continuar|ficar)(?:\s+(?:o|a|os|as|com|plano|atual|mesmo|opcao|de|\d+|mega|megas))*[.!\s]*$/.test(normalizeText(text)) || /^nao[ ,.!]*(?:obrigad[oa])?[.!\s]*$/.test(normalizeText(text));
}
function isStopRequest(text: string) {
  return /^(?:quero\s+)?(?:encerrar|encerr[ae]|cancelar|cancele|parar|pare)(?:\s+(?:o|a|de|me|enviar|mandar|atendimento|conversa|mensagens|contato))*[.!\s]*$/.test(normalizeText(text)) || /^(?:nao quero mais|nao tenho mais interesse|nao me (?:mande|envie) mais mensagens)[.!\s]*$/.test(normalizeText(text));
}

function hasManualAddress(text: string) {
  if (/^(?:(?:o|a|meu|minha) )?(?:rua|bairro|endereco|avenida|numero|complemento)(?: (?:esta|ta|e|foi))? (?:errad[oa]|incorret[oa]|incomplet[oa])[.! ]*$/.test(normalizeText(text))) return false;
  return /\b(?:rua|avenida|av\.|travessa|rodovia|alameda|estrada|fazenda|bairro|cidade|complemento|apartamento|apto|bloco|quadra|lote|ponto de refer[eê]ncia)\s+\S/i.test(text);
}
function applyManualAddress(memory: ChatMemory, text: string) {
  const lines = text.trim().slice(0, 1500);
  const street = [...lines.matchAll(/\b(?:rua|avenida|av\.|travessa|rodovia|alameda|estrada|fazenda)\s+[^\n;,]+?(?=\s+(?:bairro|cidade|cep|numero|n[uú]mero)\b|\s+n[º°]\s*\d|[,;\n]|$)/gi)].at(-1)?.[0];
  if (street) memory.address = street.trim();
  const neighborhood = lines.match(/\bbairro\s*[:=-]?\s*([^\n;,]+?)(?=\s+(?:cidade|cep|rua|numero|n[uú]mero)\b|[,;\n]|$)/i)?.[1];
  if (neighborhood) memory.neighborhood = neighborhood.trim();
  const city = lines.match(/\bcidade\s*[:=-]?\s*([^\n;,]+?)(?=\s+(?:cep|estado|uf)\b|[,;\n]|$)/i)?.[1];
  if (city) memory.city = city.trim();
  const state = lines.match(/\b(?:uf|estado)\s*[:=-]?\s*([a-z]{2})\b/i)?.[1];
  if (state) memory.state = state.toUpperCase();
  const number = parseSimpleNumber(lines);
  if (number) memory.streetNumber = number;
  const complement = lines.match(/\b(?:complemento|ponto de refer[eê]ncia)\s*[:=-]?\s*([^\n;]+)/i)?.[1] || lines.match(/\b(?:apartamento|apto|ap\.?|bloco|quadra|lote)\s+[^\n;]+/i)?.[0];
  if (complement) memory.complement = complement.trim();
}
