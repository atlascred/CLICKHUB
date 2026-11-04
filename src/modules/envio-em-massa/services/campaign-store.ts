import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Campaign, CampaignStore } from "./mass-message.service";
export const campaignKey = (id: string) => `chatbot:meta-campaign:${id}`;
export const campaignStore: CampaignStore = {
  async get(id) {
    const row = await prisma.appSetting.findUnique({ where: { key: campaignKey(id) } });
    return row ? row.value as unknown as Campaign : null;
  },
  async create(campaign) {
    // No update on conflict: the caller's campaign ID is its idempotency key.
    await prisma.appSetting.upsert({ where: { key: campaignKey(campaign.id) }, create: { key: campaignKey(campaign.id), value: campaign as unknown as Prisma.InputJsonValue }, update: {} });
  },
  async replace(previous, next) {
    const result = await prisma.appSetting.updateMany({ where: { key: campaignKey(previous.id), value: { equals: previous as unknown as Prisma.InputJsonValue } }, data: { value: next as unknown as Prisma.InputJsonValue } });
    return result.count === 1;
  },
};
