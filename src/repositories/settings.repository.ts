import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class SettingsRepository {
  async findMany() {
    return prisma.appSetting.findMany({ where: { NOT: { key: { startsWith: "chatbot:" } } }, orderBy: { key: "asc" } });
  }

  async upsert(key: string, value: Prisma.InputJsonValue) {
    if (key.startsWith("chatbot:")) throw new Error("Chave operacional reservada.");
    return prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
