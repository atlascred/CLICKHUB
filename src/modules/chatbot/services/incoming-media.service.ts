import type { ExtractedCustomerData } from "@/services/openai/openai.service";

export interface MediaIntelligence {
  transcribeAudio(input: { url: string; mimeType: string }): Promise<string>;
  extractCustomerData(input: { url: string; mimeType: string }): Promise<ExtractedCustomerData>;
}

export async function interpretIncomingMedia(ai: MediaIntelligence, input: { kind: string; message: string; mediaUrl?: string; mimeType?: string }) {
  if (input.kind === "audio") {
    try {
      const text = input.mediaUrl ? await ai.transcribeAudio({ url: input.mediaUrl, mimeType: input.mimeType || "audio/ogg" }) : "";
      return { message: text || "[Áudio não pôde ser transcrito]" };
    } catch { return { message: "[Áudio não pôde ser transcrito]" }; }
  }
  if (["imagem", "documento"].includes(input.kind)) {
    try {
      const extractedData = input.mediaUrl ? await ai.extractCustomerData({ url: input.mediaUrl, mimeType: input.mimeType || (input.kind === "imagem" ? "image/jpeg" : "application/pdf") }) : {};
      return { message: input.message || "[Documento recebido]", extractedData };
    } catch { return { message: input.message || "[Documento ilegível]", extractedData: {} }; }
  }
  return { message: input.message };
}
