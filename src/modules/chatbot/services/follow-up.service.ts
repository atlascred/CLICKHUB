import { FollowUpRepository } from "@/repositories/follow-up.repository";
import { nextFollowUp } from "@/modules/chatbot/follow-up";
import { resolveEvolutionMessageId, sendEvolutionTextMessage } from "@/services/evolution";
import { withEvolutionInstance } from "@/services/evolution-context";

export class FollowUpService {
  constructor(private readonly repository = new FollowUpRepository(),
    private readonly send = (instanceName: string, phone: string, message: string) => withEvolutionInstance(instanceName, () => sendEvolutionTextMessage({ to: phone, message })),
    private readonly now = () => new Date()) {}
  async process(dryRun = false) {
    const settings = await this.repository.settings();
    const result = { enabled: settings.enabled, due: 0, sent: 0, skipped: 0, failed: 0, dryRun };
    if (!settings.enabled) return result;
    const started = this.now().getTime();
    for (let skip = 0; skip < 1000 && this.now().getTime() - started < 40_000; skip += 100) {
      const candidates = await this.repository.candidates(settings, this.now(), skip);
      for (const conversation of candidates) {
        if (this.now().getTime() - started >= 40_000 || result.sent + result.failed >= 8) return result;
        const next = nextFollowUp(conversation, settings, this.now());
        if (!next) continue;
        result.due++;
        if (dryRun) continue;
        if (!(await this.repository.claim(next.key, conversation.id, conversation.state, this.now()))) { result.skipped++; continue; }
        try {
          const current = await this.repository.get(conversation.id);
          const activeSettings = await this.repository.settings();
          const verified = current && nextFollowUp(current, activeSettings, this.now());
          if (!verified || verified.key !== next.key || verified.instanceName !== next.instanceName || current.agent?.id !== conversation.agent?.id || current.state !== conversation.state || current.updatedAt.getTime() !== conversation.updatedAt.getTime()) {
            await this.repository.mark(next.key, "cancelled"); result.skipped++; continue;
          }
          // Persist intent before the external send. Uncertain sends require review, never blind retries.
          await this.repository.mark(next.key, "sending");
          const sentAt = this.now();
          const response = await this.send(next.instanceName, conversation.phone, verified.body);
          const messageId = resolveEvolutionMessageId(response);
          if (!messageId) throw new Error("Confirmação de envio sem identificador.");
          await this.repository.save({ conversationId: conversation.id, instanceName: next.instanceName, messageId,
            body: verified.body, sentAt, anchorId: next.anchorId, stage: next.stage });
          await this.repository.mark(next.key, "sent", { sentAt: sentAt.toISOString() }); result.sent++;
        } catch {
          await this.repository.mark(next.key, "review_required").catch(() => undefined); result.failed++;
        }
      }
      if (candidates.length < 100) break;
    }
    return result;
  }
}
