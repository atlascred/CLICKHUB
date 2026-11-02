import { withEvolutionInstance, scopedEvolutionId, webhookInstance, currentEvolutionInstance } from "@/services/evolution-context";
import { ChatbotRepository } from "@/repositories/chatbot.repository";
import { createHash } from "node:crypto";
import { MessageBatchService } from "@/modules/chatbot/services/message-batch.service";
import { interpretIncomingMedia } from "@/modules/chatbot/services/incoming-media.service";
import { Prisma } from "@prisma/client";
import { Buffer } from "node:buffer";
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
import {
  downloadMetaMediaBytes,
  isMetaWhatsAppEnabled,
  isValidMetaWebhook,
  parseMetaWebhookPayload,
  verifyMetaWebhookChallenge,
} from "@/services/meta-whatsapp";

const chatbotEngineService = new ChatbotEngineService();
const openAiService = new OpenAiService();
const batchService = new MessageBatchService();

export async function handleEvolutionWebhook(request: Request) {
  const rawBody = await request.text();
  if (isMetaWhatsAppEnabled()) {
    return handleMetaWebhook(request, rawBody);
  }

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
  const eventName = String(payload.event ?? "").toLowerCase();
  const isMessageEvent = eventName === "messages.upsert" || eventName.includes("messages.upsert");
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
      await prisma.chatMessage.updateMany({
        where: { providerId: { in: [scopedEvolutionId(instanceName, update.messageId), update.messageId] }, conversation: { agentId: agent.id } },
        data: {
          rawPayload: {
            provider: "evolution",
            status: update.status,
            rawLastStatus: redactCredentials(payload),
          } as Prisma.InputJsonValue,
          readAt: update.status === "lido" ? new Date() : undefined,
        },
      });
    }
    return NextResponse.json(successResponse("Status processado.", { updates: updates.length }));
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

  if (parsed.direction === "saida") {
    return NextResponse.json(successResponse("Mensagem propria ignorada.", { ignored: true }));
  }

  if (parsed.phone && parsed.phone === currentEvolutionInstance().number) {
    return NextResponse.json(successResponse("Mensagem do numero da instancia ignorada.", {
      ignored: true,
      phone: parsed.phone,
    }));
  }

  if (await isBlockedConversation(parsed.phone, agent.id)) {
    return NextResponse.json(successResponse("Contato bloqueado ignorado.", { ignored: true, blocked: true }));
  }

  if (!parsed.phone) return NextResponse.json(errorResponse("Contato inválido.", "INVALID_WEBHOOK"), { status: 422 });
  try {
    const incoming = await interpretIncomingMedia(openAiService, parsed);
    const providerId = scopedEvolutionId(instanceName, parsed.messageId || `event:${createHash("sha256").update(rawBody).digest("hex")}`);
    const rawPayload = redactCredentials({ provider: "evolution", instanceName, kind: parsed.kind, mediaUrl: parsed.mediaUrl, mimeType: parsed.mimeType, raw: parsed.raw });
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
  return NextResponse.json(successResponse("Webhook Evolution ativo.", { ok: true, isolationVersion: 1 }));
}

export async function handleWhatsAppWebhookHealth(request: Request) {
  if (isMetaWhatsAppEnabled()) {
    const challenge = verifyMetaWebhookChallenge(request);
    if (challenge) return new NextResponse(challenge, { status: 200 });
    return NextResponse.json(successResponse("Webhook Meta WhatsApp ativo.", { ok: true, provider: "meta" }));
  }
  return handleEvolutionWebhookHealth();
}

async function handleMetaWebhook(request: Request, rawBody: string) {
  if (!isValidMetaWebhook(request, rawBody)) {
    return NextResponse.json(errorResponse("Webhook Meta nao autorizado.", "UNAUTHORIZED"), { status: 401 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return NextResponse.json(errorResponse("Payload invalido.", "INVALID_WEBHOOK"), { status: 422 });
  }

  const parsed = parseMetaWebhookPayload(payload);
  if (!parsed) {
    return NextResponse.json(successResponse("Evento Meta ignorado.", { ignored: true }));
  }

  if (parsed.event === "status") {
    for (const update of parsed.updates) {
      await prisma.chatMessage.updateMany({
        where: { providerId: update.messageId },
        data: {
          rawPayload: {
            provider: "meta",
            status: update.status,
            rawLastStatus: payload,
          } as Prisma.InputJsonValue,
          readAt: update.status === "lido" ? new Date() : undefined,
        },
      });
    }
    return NextResponse.json(successResponse("Status Meta processado.", { updates: parsed.updates.length }));
  }

  if (await isBlockedConversation(parsed.phone)) {
    return NextResponse.json(successResponse("Contato bloqueado ignorado.", { ignored: true, blocked: true }));
  }

  const body = await resolveMetaIncomingMessageBody(parsed);
  try {
    const result = await chatbotEngineService.processIncomingMessage({
      phone: parsed.phone,
      message: body,
      providerId: parsed.messageId,
      rawPayload: {
        provider: "meta",
        kind: parsed.kind,
        mediaId: parsed.mediaId,
        mediaUrl: parsed.mediaUrl,
        mimeType: parsed.mimeType,
        fileName: parsed.fileName,
        transcription: parsed.kind === "audio" ? body : undefined,
        raw: parsed.raw,
      } as Prisma.InputJsonValue,
      instanceId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
      provider: "meta",
    });
    return NextResponse.json(successResponse("Webhook Meta processado.", result));
  } catch (error) {
    await writeTechnicalLog({
      level: "ERROR",
      category: "webhook",
      message: "Falha ao processar fluxo da Meta WhatsApp API.",
      method: "POST",
      endpoint: "/api/whatsapp/webhook",
      integration: "meta-whatsapp",
      metadata: { errorType: error instanceof Error ? error.name : "unknown", reviewRequired: true },
    });
    return NextResponse.json(errorResponse("Nao foi possivel processar o fluxo da Meta."), { status: 500 });
  }
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

async function isBlockedConversation(phone: string, agentId?: string) {
  const conversation = await prisma.chatConversation.findFirst({
    where: { phone, deletedAt: null, ...(agentId ? { agentId } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { memory: true, state: true },
  });
  if (!conversation) return false;
  const memory = conversation.memory && typeof conversation.memory === "object" && !Array.isArray(conversation.memory)
    ? conversation.memory as Record<string, unknown>
    : {};
  return conversation.state === "BLOCKED" || memory.blocked === true;
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

async function resolveMetaIncomingMessageBody(parsed: NonNullable<ReturnType<typeof parseMetaWebhookPayload>>) {
  if (parsed.event !== "message") return "";
  if (parsed.kind !== "audio") return parsed.message || defaultWebhookMessageLabel(parsed.kind);

  if (!parsed.mediaId) {
    return "[Áudio recebido sem arquivo para transcrição]";
  }

  try {
    const media = await downloadMetaMediaBytes(parsed.mediaId);
    const base64 = Buffer.from(media.bytes).toString("base64");
    const transcription = await openAiService.transcribeAudio({
      url: `data:${parsed.mimeType || media.mimeType};base64,${base64}`,
      mimeType: parsed.mimeType || media.mimeType || "audio/ogg",
    });
    return transcription || "[Áudio não pôde ser transcrito]";
  } catch (error) {
    await writeTechnicalLog({
      level: "ERROR",
      category: "webhook",
      message: "Falha ao transcrever áudio recebido pela Meta WhatsApp API.",
      method: "POST",
      endpoint: "/api/whatsapp/webhook",
      integration: "meta-whatsapp",
      metadata: {
        error: error instanceof Error ? error.message : "unknown",
        mimeType: parsed.mimeType,
        hasMediaId: Boolean(parsed.mediaId),
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
