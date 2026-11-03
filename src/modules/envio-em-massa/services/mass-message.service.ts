import { normalizePhone } from "@/services/validators";
type Media = { fileName: string; mimeType: string; dataUrl: string };
export class MassMessageService {
  constructor(private readonly sendOne: (phone: string, payload: Record<string, unknown>) => Promise<void>) {}
  async send(input: { contactsText: string; message?: string; caption?: string; media?: Media }) {
    const contacts = [...new Set(input.contactsText.split(/[\r\n;,]+/).map(normalizePhone).filter(phone=>/^55\d{10,11}$/.test(phone)))];
    if (!contacts.length) throw new Error("Informe pelo menos um WhatsApp válido com DDD.");
    if (contacts.length > 100) throw new Error("Envie até 100 contatos por lote.");
    if (!input.message?.trim() && !input.media) throw new Error("Informe uma mensagem ou anexe uma mídia.");
    const media = input.media;
    const payload: Record<string, unknown> = media ? {
      message: input.caption?.trim() || input.message?.trim(), mimeType: media.mimeType, fileName: media.fileName,
      ...(media.mimeType.startsWith("audio/") ? { audio: media.dataUrl } : { media: media.dataUrl,
        kind: media.mimeType.startsWith("image/") ? "imagem" : media.mimeType.startsWith("video/") ? "video" : "documento" }),
    } : { message: input.message!.trim() };
    const results: Array<{phone:string;status:"sent"|"failed";detail:string}> = [];
    for (const phone of contacts) {
      try { await this.sendOne(phone,payload); results.push({phone,status:"sent",detail:"Enviado com sucesso."}); }
      catch(error) { results.push({phone,status:"failed",detail:error instanceof Error?error.message:"Falha no envio."}); }
    }
    const sent=results.filter(item=>item.status==="sent").length;
    return {total:contacts.length,sent,failed:contacts.length-sent,contacts:results};
  }
}
