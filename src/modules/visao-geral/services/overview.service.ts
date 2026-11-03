import type { User } from "@prisma/client";
import { OverviewRepository, type OverviewData, type OverviewFilters } from "@/repositories/overview.repository";

export class OverviewService {
  constructor(private readonly overviewRepository = new OverviewRepository()) {}

  async getOverview(filters: OverviewFilters, user?: Pick<User, "id" | "role">): Promise<OverviewData> {
    return this.overviewRepository.getOverview(filters, user);
  }
}
