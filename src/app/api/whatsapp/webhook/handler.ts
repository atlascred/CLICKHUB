import { saveEvolutionOutbound } from "@/repositories/evolution-outbound.repository";
import { mergeEvolutionStatus } from "@/repositories/message-status.repository";
import { getOpenAiRuntimeConfig } from "@/lib/integration-config";
import { downloadEvolutionMedia } from "@/services/evolution-media";
import { withEvolutionInstance, scopedEvolutionId, webhookInstance, currentEvolutionInstance } from "@/services/evolution-context";
import { ChatbotRepository } from "@/repositories/chatbot.repository";
import { createHash } from "node:crypto";
import { MessageBatchService } from "@/modules/chatbot/services/message-batch.service";
import { interpretIncomingMedia } from "@/modules/chatbot/services/incoming-media.service";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { writeTechnicalLog } from "@/lib/logger";
import { ChatbotEngineService } from "@/modules/chatbot/services/chatbot-engine.service";
import { OpenAiService } from "@/services/openai/openai.service";
import {
  extractEvolutionStatusUpdates,
  isEvolutionStatusWebhook,
  isValidEvolutionWebhook,
  parseEvolutionWebhookPayload,
} from "@/services/evolution";

const chatbotEngineService = new ChatbotEngineService();
const openAiService = new OpenAiService();
const batchService = new MessageBatchService();

export async function handleEvolutionWebhook(request: Request) {
  const rawBody = await request.text();

  const payload = parsePayload(rawBody);
  if (!payload) return NextResponse.json(errorResponse("Payload inválido.", "INVALID_WEBHOOK"), { status: 422 });
  try {
    const instanceName = webhookInstance(request, payload);
    return await withEvolutionInstance(instanceName, () => processEvolutionWebhook(request, rawBody, payload, instanceName));
  } catch {
    return NextResponse.json(errorResponse("Instância não autorizada ou indisponível.", "INSTANCE_UNAVAILABLE"), { status: 503 });
  }
}

async function processEvolutionWebhook(request: Request, rawBody: string, payload: Record<string, unknown>, instanceName: string) {
  if (!isValidEvolutionWebhook(request, rawBody)) return NextResponse.json(errorResponse("Webhook não autorizado.", "UNAUTHORIZED"), { status: 401 });
  const agent = await new ChatbotRepository().getAgentByInstance(instanceName, true);
  if (!agent) throw new Error("Agente da instância não encontrado.");
  const eventName = String(payload.event ?? "").toLowerCase().replace(/_/g, ".");
  const isMessageEvent = eventName === "messages.upsert" || eventName.includes("messages.upsert") || eventName === "send.message";
  const isStatusEvent = isEvolutionStatusWebhook(payload);
  const isPresenceEvent = eventName.includes("presence");

  if (!isMessageEvent && !isStatusEvent && !isPresenceEvent) {
    return NextResponse.json(successResponse("Evento ignorado.", {
      ignored: true,
      event: payload.event ?? null,
    }));
  }

  if (isEvolutionStatusWebhook(payload)) {
    const updates = extractEvolutionStatusUpdates(payload);
    for (const update of updates) {
      await mergeEvolutionStatus(prisma, { instanceName, agentId: agent.id, messageId: update.messageId,
        status: update.status, raw: redactCredentials(payload) as Prisma.InputJsonValue });
    }
    return NextResponse.json(successResponse("Status processado.", { updates: updates.length }));
  }

  const eventData = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  const eventKey = eventData.key && typeof eventData.key === "object" ? eventData.key as Record<string, unknown> : {};
  const remoteJid = String(eventKey.remoteJid ?? eventData.remoteJid ?? "");
  if (/@(?:g\.us|broadcast|newsletter)$/.test(remoteJid)) {
    return NextResponse.json(successResponse("Evento fora de conversa individual ignorado.", { ignored: true }));
  }
  const parsed = parseEvolutionWebhookPayload(payload);
  if (parsed.event === "presence") {
    await upsertConversationMemory(parsed.phone, {
      contactName: parsed.contactName || undefined,
      presenceStatus: parsed.presenceStatus,
      rawLastPresence: redactCredentials(parsed.raw),
    }, agent.id);
    return NextResponse.json(successResponse("Presenca processada.", { phone: parsed.phone }));
  }

  if (parsed.phone && parsed.phone === currentEvolutionInstance().number) {
    return NextResponse.json(successResponse("Mensagem do numero da instancia ignorada.", {
      ignored: true,
      phone: parsed.phone,
    }));
  }

  if (!parsed.phone) return NextResponse.json(errorResponse("Contato inválido.", "INVALID_WEBHOOK"), { status: 422 });
  if (parsed.direction === "saida" || eventName === "send.message") {
    // Outbound events are history only: never enqueue them as customer input or run AI.
    if (!parsed.message && parsed.kind === "texto") {
      return NextResponse.json(successResponse("Evento sem conteúdo ignorado.", { ignored: true }));
    }
    try {
      const messageId = parsed.messageId || `event:${createHash("sha256").update(rawBody).digest("hex")}`;
      const message = await saveEvolutionOutbound(prisma, {
        instanceName, agentId: agent.id, phone: parsed.phone, messageId,
        body: parsed.message || ({ imagem: "Imagem", audio: "Áudio", video: "Vídeo", documento: "Documento", texto: "Mensagem" }[parsed.kind]),
        sentAt: parsed.sentAt,
        rawPayload: redactCredentials({ provider: "evolution", instanceName, kind: parsed.kind,
          mediaUrl: parsed.mediaUrl, mimeType: parsed.mimeType, fileName: parsed.fileName, raw: parsed.raw }) as Prisma.InputJsonValue,
      });
      return NextResponse.json(successResponse("Mensagem de saída sincronizada.", { conversationId: message.conversationId }));
    } catch {
      return NextResponse.json(errorResponse("Não foi possível sincronizar a mensagem de saída."), { status: 500 });
    }
  }

  const conversationGuard = await getConversationGuard(parsed.phone, agent.id);
  if (conversationGuard.blocked) {
    return NextResponse.json(successResponse("Contato bloqueado ignorado.", { ignored: true, blocked: true }));
  }

  try {
    const rawPayload = redactCredentials({ provider: "evolution", instanceName, kind: parsed.kind, mediaUrl: parsed.mediaUrl, mimeType: parsed.mimeType, fileName: parsed.fileName, raw: parsed.raw });
    let mediaInput = { ...parsed };
    let intelligence = openAiService;
    if (["audio", "imagem", "documento"].includes(parsed.kind)) {
      const config = conversationGuard.automationEnabled ? await getOpenAiRuntimeConfig() : { apiKey: "", model: "gpt-4o-mini" };
      intelligence = new OpenAiService(async () => config);
      // Authorized by the owner: decrypt in the originating instance before AI processing.
      // Without a key, keep the original attachment available in the panel and request text.
      mediaInput.mediaUrl = undefined;
      if (config.apiKey) {
        try {
          const downloaded = await downloadEvolutionMedia(rawPayload);
          const mime = downloaded.mimeType.split(";")[0];
          mediaInput = { ...parsed, mimeType: mime, fileName: downloaded.fileName,
            mediaUrl: `data:${mime};base64,${downloaded.bytes.toString("base64")}` };
        } catch { /* Never interpret encrypted/unavailable bytes as customer data. */ }
      }
    }
    const incoming = await interpretIncomingMedia(intelligence, mediaInput);
    const providerId = scopedEvolutionId(instanceName, parsed.messageId || `event:${createHash("sha256").update(rawBody).digest("hex")}`);
    const result = await batchService.accept(`evolution:${instanceName}:${parsed.phone}`, {
      providerId, body: incoming.message, extractedData: incoming.extractedData,
      rawPayload: rawPayload as Prisma.InputJsonValue,
    }, async messages => chatbotEngineService.processIncomingMessage({
      phone: parsed.phone,
      message: messages.map(m => m.body).join("\n"),
      providerId: messages[0].providerId,
      batchMessages: messages,
      extractedData: messages.some(m => m.extractedData !== undefined)
        ? Object.assign({}, ...messages.map(m => m.extractedData ?? {})) : undefined,
      rawPayload: messages[0].rawPayload,
      instanceId: instanceName,
      resolvedAgent: agent,
      provider: "evolution",
    }));

    return NextResponse.json(successResponse("Webhook processado.", result));
  } catch (error) {
    await writeTechnicalLog({
      level: "ERROR",
      category: "webhook",
      message: "Falha ao processar fluxo da Evolution API.",
      method: "POST",
      endpoint: "/api/whatsapp/webhook",
      integration: "evolution",
      metadata: { errorType: error instanceof Error ? error.name : "unknown", reviewRequired: true },
    });
    return NextResponse.json(errorResponse("Nao foi possivel processar o fluxo da Evolution."), { status: 500 });
  }
}

export function handleEvolutionWebhookHealth() {
  return NextResponse.json(successResponse("Webhook Evolution ativo.", { ok: true, isolationVersion: 1, coverageVersion: 1, outboundSyncVersion: 1 }));
}

export async function handleWhatsAppWebhookHealth(_request: Request) {
  return handleEvolutionWebhookHealth();
}

function parsePayload(rawBody: string) {
  try {
    const payload = JSON.parse(rawBody);
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function upsertConversationMemory(phone: string, input: Record<string, unknown>, agentId?: string) {
  const conversation = await prisma.chatConversation.findFirst({
    where: { phone, deletedAt: null, ...(agentId ? { agentId } : {}) },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) return null;

  // Merge presence only; never replace a concurrently updated flow or human-control flag.
  return prisma.$executeRaw`
    UPDATE "ChatConversation"
    SET "memory" = COALESCE("memory", '{}'::jsonb) || ${JSON.stringify(input)}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${conversation.id}::uuid
  `;
}

async function getConversationGuard(phone: string, agentId?: string) {
  const conversation = await prisma.chatConversation.findFirst({
    where: { phone, deletedAt: null, ...(agentId ? { agentId } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { memory: true, state: true, ownerUserId: true },
  });
  if (!conversation) return {blocked:false,automationEnabled:true};
  const memory = conversation.memory && typeof conversation.memory === "object" && !Array.isArray(conversation.memory)
    ? conversation.memory as Record<string, unknown>
    : {};
  const blocked = conversation.state === "BLOCKED" || memory.blocked === true;
  return { blocked, automationEnabled: !blocked && !conversation.ownerUserId && memory.humanTakeover !== true && !["FINISHED", "FINISHED_UNAVAILABLE", "HUMAN_HANDOFF", "MANUAL"].includes(conversation.state) };
}

function defaultWebhookMessageLabel(kind: string) {
  if (kind === "imagem") return "Imagem recebida";
  if (kind === "audio") return "Áudio recebido";
  if (kind === "video") return "Video recebido";
  if (kind === "documento") return "Documento recebido";
  return "Mensagem recebida";
}

async function resolveIncomingMessageBody(parsed: ReturnType<typeof parseEvolutionWebhookPayload>) {
  if (parsed.event !== "message") return "";
  if (parsed.kind !== "audio") return parsed.message || defaultWebhookMessageLabel(parsed.kind);

  if (!parsed.mediaUrl) {
    return "[Áudio recebido sem arquivo para transcrição]";
  }

  try {
    const transcription = await openAiService.transcribeAudio({
      url: parsed.mediaUrl,
      mimeType: parsed.mimeType || "audio/ogg",
    });
    return transcription || "[Áudio não pôde ser transcrito]";
  } catch (error) {
    await writeTechnicalLog({
      level: "ERROR",
      category: "webhook",
      message: "Falha ao transcrever áudio recebido pela Evolution API.",
      method: "POST",
      endpoint: "/api/whatsapp/webhook",
      integration: "evolution",
      metadata: {
        error: error instanceof Error ? error.message : "unknown",
        mimeType: parsed.mimeType,
        hasMediaUrl: Boolean(parsed.mediaUrl),
      },
    });
    return "[Áudio não pôde ser transcrito]";
  }
}

function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/apikey|token|secret|authorization|password/i.test(key)).map(([key, item]) => [key, redactCredentials(item)]));
  return value;
}
