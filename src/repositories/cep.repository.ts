import type { Prisma } from "@prisma/client";
import { AGENT_COVERAGE_PREFIX } from "@/modules/chatbot/coverage-policy";
import { prisma } from "@/lib/prisma";

export type UpsertCoverageCepInput = {
  cep: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  street?: string;
  available?: boolean;
  importedFrom?: string;
};

export function coverageScopeWhere(dataset?: string): Prisma.CoverageCepWhereInput {
  return dataset ? { importedFrom: dataset } : { OR: [{ importedFrom: null }, { NOT: { importedFrom: { startsWith: AGENT_COVERAGE_PREFIX } } }] };
}

export class CepRepository {
  constructor(private readonly db = prisma) {}
  async overview(dataset?: string) {
    const [total, available, recent, cities] = await Promise.all([
      this.db.coverageCep.count({ where: { deletedAt: null, ...coverageScopeWhere(dataset) } }),
      this.db.coverageCep.count({ where: { deletedAt: null, ...coverageScopeWhere(dataset), available: true } }),
      this.db.coverageCep.findMany({
        where: { deletedAt: null, ...coverageScopeWhere(dataset) },
        orderBy: { importedAt: "desc" },
        take: 8,
      }),
      this.db.coverageCep.groupBy({
        by: ["city", "state"],
        where: { deletedAt: null, ...coverageScopeWhere(dataset), city: { not: null } },
        _count: { cep: true },
        orderBy: { _count: { cep: "desc" } },
        take: 8,
      }),
    ]);

    return {
      total,
      available,
      unavailable: total - available,
      recent,
      cities: cities.map((city) => ({
        city: city.city,
        state: city.state,
        count: city._count.cep,
      })),
    };
  }

  async upsertOne(item: UpsertCoverageCepInput) {
    const now = new Date();
    const existing = await this.db.coverageCep.findFirst({ where: { cep: item.cep, deletedAt: null, ...coverageScopeWhere() } });
    if (!existing) {
      return this.db.coverageCep.create({ data: {
        ...item,
        available: item.available ?? true,
        importedAt: now,
      } });
    }
    return this.db.coverageCep.update({
      where: { id: existing.id },
      data: {
        city: item.city,
        state: item.state,
        neighborhood: item.neighborhood,
        street: item.street,
        available: item.available ?? true,
        importedFrom: item.importedFrom,
        importedAt: now,
        deletedAt: null,
      }
    });
  }

  async upsertMany(items: UpsertCoverageCepInput[]) {
    const now = new Date();
    let imported = 0;

    for (const batch of chunk(items, 250)) {
      const result = await this.db.$transaction(
        batch.map((item) =>
          this.db.coverageCep.create({
            data: {
              ...item,
              available: item.available ?? true,
              importedAt: now,
            },
          }),
        ),
      );
      imported += result.length;
    }

    return imported;
  }

  async createManyPreservingRows(
    items: UpsertCoverageCepInput[],
    onProgress?: (processed: number, total: number) => void,
  ) {
    const now = new Date();
    let imported = 0;
    let processed = 0;

    await this.db.coverageCep.deleteMany({
      where: {
        importedFrom: { not: "cadastro-manual" },
        ...coverageScopeWhere(),
      },
    });

    for (const batch of chunk(items, 5000)) {
      const result = await this.db.coverageCep.createMany({
        data: batch.map((item) => ({
          ...item,
          available: item.available ?? true,
          importedAt: now,
        })),
      });
      imported += result.count;
      processed += batch.length;
      onProgress?.(processed, items.length);
    }

    return imported;
  }

  async findByCep(cep: string, dataset?: string) {
    return this.db.coverageCep.findFirst({
      where: { cep, available: true, deletedAt: null, ...coverageScopeWhere(dataset) },
      orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }],
    });
  }

  async findManyByCeps(ceps: string[], dataset?: string) {
    if (!ceps.length) return [];
    return this.db.coverageCep.findMany({
      where: {
        cep: { in: ceps },
        ...coverageScopeWhere(dataset),
        available: true,
        deletedAt: null,
      },
      orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }],
    });
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
