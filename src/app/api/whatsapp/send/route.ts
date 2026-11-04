import { saveEvolutionOutbound } from "@/repositories/evolution-outbound.repository";
import { withEvolutionInstance, scopedEvolutionId } from "@/services/evolution-context";
import { resolveSelectedAgent } from "@/services/whatsapp-agent";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { permissions } from "@/constants/permissions";
import { authErrorResponse } from "@/lib/api-errors";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/permissions";
import { resolveEvolutionMessageId, resolveEvolutionPhone, sendEvolutionAudioMessage, sendEvolutionMediaMessage, sendEvolutionTextMessage } from "@/services/evolution";
import { normalizePhone } from "@/services/validators";

export const runtime = "nodejs";
export const maxDuration = 60;

type SendBody = {
  to?: string;
  agentId?: string;
  message?: string;
  audio?: string;
  media?: string;
  kind?: "imagem" | "video" | "documento";
  mimeType?: string;
  fileName?: string;
  conversationId?: string;
  contactName?: string;
  tags?: unknown;
};

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    assertPermission(user, permissions.conversationsView);
    const body = await request.json().catch(() => null) as SendBody | null;
    if (!body?.to || (!body.message && !body.audio && !body.media)) {
      return NextResponse.json(errorResponse("Destino e mensagem, audio ou anexo sao obrigatorios.", "VALIDATION_ERROR"), { status: 422 });
    }

    const existing = body.conversationId ? await prisma.chatConversation.findFirst({ where: { id: body.conversationId, deletedAt: null } }) : null;
    if (body.conversationId && !existing) throw new Error("Conversa não encontrada.");
    if (existing && normalizePhone(existing.phone) !== normalizePhone(body.to)) throw new Error("O destino não corresponde à conversa selecionada.");
    if (existing?.agentId && body.agentId && existing.agentId !== body.agentId) throw new Error("A conversa pertence a outro agente.");
    const agent = await resolveSelectedAgent(existing?.agentId || body.agentId);
    const destinationInput = body.to;
    const execute = async () => {
    const resolvedPhone = await resolveEvolutionPhone(destinationInput);
    const destinationPhone = resolvedPhone.phone || normalizePhone(destinationInput);
    const result = body.audio
      ? await sendEvolutionAudioMessage({ to: destinationPhone, audio: body.audio, mimeType: body.mimeType })
      : body.media && body.kind
        ? await sendEvolutionMediaMessage({
            to: destinationPhone,
            media: body.media,
            kind: body.kind,
            caption: body.message,
            fileName: body.fileName,
            mimeType: body.mimeType,
          })
        : await sendEvolutionTextMessage({ to: destinationPhone, message: body.message as string, delayTypingSeconds: 2 });

    const rawProviderId = resolveEvolutionMessageId(result);
    const providerId = rawProviderId && agent?.zapiInstanceId ? scopedEvolutionId(agent.zapiInstanceId, rawProviderId) : rawProviderId;
    const conversation = await findOrCreateConversation({
      id: body.conversationId,
      agentId: agent?.id,
      phone: destinationPhone,
      contactName: body.contactName,
      ownerUserId: user.id,
      tags: body.tags,
    });

    const messageKind = body.audio ? "audio" : body.media ? body.kind : "texto";
    const content = body.audio ? "Audio" : body.message || defaultMediaLabel(body.kind);
    const messageData = {
        conversationId: conversation.id,
        direction: "outbound" as const,
        body: content,
        providerId,
        sentAt: new Date(),
        rawPayload: {
          provider: "evolution",
          instanceName: agent?.zapiInstanceId,
          kind: messageKind,
          media: body.media || body.audio ? { source: body.audio || body.media, kind: messageKind, mimeType: body.mimeType, fileName: body.fileName || (body.audio ? "audio" : undefined) } : undefined,
          result: normalizeJson(result),
        } as Prisma.InputJsonValue,
      };
    const savedMessage = rawProviderId && agent?.zapiInstanceId
      ? await saveEvolutionOutbound(prisma, { instanceName: agent.zapiInstanceId, messageId: rawProviderId,
          conversationId: conversation.id, body: content, rawPayload: messageData.rawPayload, sentAt: messageData.sentAt })
      : await prisma.chatMessage.create({ data: messageData });
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json(successResponse("Mensagem enviada.", { result, conversationId: savedMessage.conversationId }));
    };
    return agent?.zapiInstanceId ? await withEvolutionInstance(agent.zapiInstanceId, execute) : await execute();
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(
      errorResponse(error instanceof Error ? error.message : "Falha ao enviar pelo WhatsApp.", "WHATSAPP_SEND_ERROR"),
      { status: 502 },
    );
  }
}

async function findOrCreateConversation(input: { id?: string; agentId?: string; phone: string; contactName?: string; ownerUserId: string; tags?: unknown }) {
  const tags = normalizeTags(input.tags);
  if (input.id) {
    const existing = await prisma.chatConversation.findFirst({ where: { id: input.id, deletedAt: null, ...(input.agentId ? { OR: [{ agentId: input.agentId }, { agentId: null }] } : {}) } });
    if (existing) return mergeConversationTags(existing, tags);
  }

  const existingByPhone = await prisma.chatConversation.findFirst({
    where: { phone: input.phone, agentId: input.agentId ?? null, deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  if (existingByPhone) return mergeConversationTags(existingByPhone, tags);

  return prisma.chatConversation.create({
    data: {
      phone: input.phone,
      agentId: input.agentId,
      state: "MANUAL",
      ownerUserId: input.ownerUserId,
      memory: {
        contactName: input.contactName?.trim() || input.phone,
        assignedTo: "Equipe",
        tags,
      },
    },
  });
}

async function mergeConversationTags<T extends { id: string; memory: Prisma.JsonValue }>(conversation: T, tags: string[]) {
  if (!tags.length) return conversation;
  const memory = normalizeJsonObject(conversation.memory);
  const currentTags = Array.isArray(memory.tags) ? memory.tags.map((tag) => String(tag)) : [];
  const mergedTags = normalizeTags([...currentTags, ...tags]);
  return prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { memory: normalizeJsonValue({ ...memory, tags: mergedTags }) },
  });
}

function normalizeTags(value: unknown) {
  const tags = Array.isArray(value)
    ? value.map((tag) => String(tag))
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function normalizeJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function defaultMediaLabel(kind?: "imagem" | "video" | "documento") {
  if (kind === "imagem") return "Imagem";
  if (kind === "video") return "Video";
  if (kind === "documento") return "Documento";
  return "Mensagem";
}


function normalizeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
