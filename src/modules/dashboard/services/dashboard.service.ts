import { DashboardRepository } from "@/repositories/dashboard.repository";
import type { DashboardFilters } from "@/repositories/dashboard.repository";
import type { LeadAccessUser } from "@/lib/lead-source-access";

export class DashboardService {
  constructor(private readonly dashboardRepository = new DashboardRepository()) {}

  async getOverview(filters?: DashboardFilters, user?: LeadAccessUser) {
    return this.dashboardRepository.getMetrics(filters, user);
  }
}
