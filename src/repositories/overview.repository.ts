import { ExpenseStatus, LeadStatus, Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { conversationAgentWhere, leadSourceWhere, type LeadAccessUser } from "@/lib/lead-source-access";

export type OverviewFilters = {
  from: Date;
  to: Date;
  preset: string;
};

export type OverviewSummary = {
  leadsCreated: number;
  leadsWon: number;
  revenue: number;
  conversationsFinished: number;
  conversationsAssumed: number;
  conversationsBotActive: number;
  tasksCompleted: number;
  expensesTotal: number;
  expensesPaid: number;
  expensesPending: number;
  expensesOverdue: number;
};

export type OverviewData = {
  range: {
    preset: string;
    from: string;
    to: string;
    label: string;
  };
  summary: OverviewSummary;
  leadStatuses: Array<{ status: string; label: string; count: number }>;
  planSales: Array<{ planName: string; count: number; totalValue: number }>;
  leadOwners: Array<{ userId: string; userName: string; totalLeads: number; wonLeads: number; openLeads: number; revenue: number }>;
  conversationBreakdown: Array<{ key: string; label: string; count: number }>;
  taskOwners: Array<{ userId: string; userName: string; total: number; completed: number; pending: number }>;
  expenseBreakdown: Array<{ status: string; label: string; count: number; totalAmount: number }>;
  timeline: Array<{ label: string; leads: number; sales: number; conversations: number; tasks: number; expenses: number }>;
};

const leadStatusLabels: Record<LeadStatus, string> = {
  NEW: "Novo",
  CONTACTED: "Contato",
  QUALIFIED: "Qualificado",
  PROPOSAL: "Proposta",
  WON: "Ganho",
  LOST: "Perdido",
};

const expenseStatusLabels: Record<ExpenseStatus, string> = {
  PAID: "Pagas",
  PENDING: "Pendentes",
  OVERDUE: "Atrasadas",
};

export class OverviewRepository {
  async getOverview(filters: OverviewFilters, user?: LeadAccessUser): Promise<OverviewData> {
    const leadWhere = buildLeadAccessWhere(user);
    const wonLeadWhere = buildWonLeadAccessWhere(user);
    const conversationWhere = buildConversationAccessWhere(user);
    const appointmentWhere = buildAppointmentAccessWhere(user);
    const expenseWhere = buildExpenseAccessWhere(user);

    const [leads, wonLeads, conversations, appointments, expenses, users] = await Promise.all([
      prisma.lead.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: filters.from, lte: filters.to },
          ...leadWhere,
        },
        include: {
          assignedUser: { select: { id: true, name: true } },
        },
      }),
      prisma.lead.findMany({
        where: {
          deletedAt: null,
          status: LeadStatus.WON,
          ...wonLeadWhere,
          OR: [
            { wonAt: { gte: filters.from, lte: filters.to } },
            { wonAt: null, updatedAt: { gte: filters.from, lte: filters.to } },
          ],
        },
        include: {
          assignedUser: { select: { id: true, name: true } },
          closedByUser: { select: { id: true, name: true } },
          plan: { select: { name: true, price: true } },
        },
      }),
      prisma.chatConversation.findMany({
        where: {
          deletedAt: null,
          updatedAt: { gte: filters.from, lte: filters.to },
          ...conversationWhere,
        },
        include: {
          lead: { select: { assignedUserId: true } },
        },
      }),
      prisma.appointment.findMany({
        where: {
          deletedAt: null,
          updatedAt: { gte: filters.from, lte: filters.to },
          ...appointmentWhere,
        },
        include: {
          responsible: { select: { id: true, name: true } },
        },
      }),
      prisma.expense.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: filters.from, lte: filters.to },
          ...expenseWhere,
        },
      }),
      prisma.user.findMany({
        where: {
          deletedAt: null,
          status: "ACTIVE",
          ...(user?.role === "EMPLOYEE" ? { id: user.id } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const summary = buildSummary({ leads, wonLeads, conversations, appointments, expenses });
    const leadStatuses = buildLeadStatuses(leads);
    const planSales = buildPlanSales(wonLeads);
    const leadOwners = buildLeadOwners(users, leads, wonLeads);
    const conversationBreakdown = buildConversationBreakdown(conversations);
    const taskOwners = buildTaskOwners(users, appointments);
    const expenseBreakdown = buildExpenseBreakdown(expenses);
    const timeline = buildTimeline({ filters, leads, wonLeads, conversations, appointments, expenses });

    return {
      range: {
        preset: filters.preset,
        from: filters.from.toISOString(),
        to: filters.to.toISOString(),
        label: formatRangeLabel(filters.from, filters.to),
      },
      summary,
      leadStatuses,
      planSales,
      leadOwners,
      conversationBreakdown,
      taskOwners,
      expenseBreakdown,
      timeline,
    };
  }
}

function buildSummary(input: {
  leads: Array<{ id: string }>;
  wonLeads: Array<{ planValue: Prisma.Decimal | null; expectedValue: Prisma.Decimal | null; plan?: { price: Prisma.Decimal } | null }>;
  conversations: Array<{ state: string; ownerUserId: string | null; memory?: Prisma.JsonValue }>;
  appointments: Array<{ status: string }>;
  expenses: Array<{ amount: Prisma.Decimal; status: ExpenseStatus }>;
}): OverviewSummary {
  return {
    leadsCreated: input.leads.length,
    leadsWon: input.wonLeads.length,
    revenue: input.wonLeads.reduce((sum, lead) => sum + getLeadValue(lead), 0),
    conversationsFinished: input.conversations.filter((conversation) => ["FINISHED", "FINISHED_UNAVAILABLE"].includes(conversation.state)).length,
    conversationsAssumed: input.conversations.filter((conversation) => Boolean(conversation.ownerUserId)).length,
    conversationsBotActive: input.conversations.filter(isBotActive).length,
    tasksCompleted: input.appointments.filter((appointment) => appointment.status === "Concluido").length,
    expensesTotal: input.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
    expensesPaid: input.expenses.filter((expense) => expense.status === ExpenseStatus.PAID).reduce((sum, expense) => sum + Number(expense.amount), 0),
    expensesPending: input.expenses.filter((expense) => expense.status === ExpenseStatus.PENDING).reduce((sum, expense) => sum + Number(expense.amount), 0),
    expensesOverdue: input.expenses.filter((expense) => expense.status === ExpenseStatus.OVERDUE).reduce((sum, expense) => sum + Number(expense.amount), 0),
  };
}

function buildLeadStatuses(leads: Array<{ status: LeadStatus }>) {
  return Object.values(LeadStatus).map((status) => ({
    status,
    label: leadStatusLabels[status],
    count: leads.filter((lead) => lead.status === status).length,
  }));
}

function buildPlanSales(wonLeads: Array<{ planName: string | null; plan?: { name: string | null; price: Prisma.Decimal } | null; planValue: Prisma.Decimal | null; expectedValue: Prisma.Decimal | null }>) {
  const grouped = new Map<string, { planName: string; count: number; totalValue: number }>();

  for (const lead of wonLeads) {
    const planName = lead.planName ?? lead.plan?.name ?? "Sem plano";
    const current = grouped.get(planName) ?? { planName, count: 0, totalValue: 0 };
    current.count += 1;
    current.totalValue += getLeadValue(lead);
    grouped.set(planName, current);
  }

  return Array.from(grouped.values()).sort((a, b) => b.totalValue - a.totalValue);
}

function buildLeadOwners(
  users: Array<{ id: string; name: string }>,
  leads: Array<{ assignedUserId: string | null; status: LeadStatus }>,
  wonLeads: Array<{ assignedUserId: string | null; closedByUserId: string | null; planValue: Prisma.Decimal | null; expectedValue: Prisma.Decimal | null; plan?: { price: Prisma.Decimal } | null }>,
) {
  const ownerMap = new Map<string, { userId: string; userName: string; totalLeads: number; wonLeads: number; openLeads: number; revenue: number }>();

  for (const user of users) {
    ownerMap.set(user.id, {
      userId: user.id,
      userName: user.name,
      totalLeads: 0,
      wonLeads: 0,
      openLeads: 0,
      revenue: 0,
    });
  }

  for (const lead of leads) {
    if (!lead.assignedUserId) continue;
    const owner = ownerMap.get(lead.assignedUserId);
    if (!owner) continue;
    owner.totalLeads += 1;
    if (lead.status === LeadStatus.WON) {
      owner.wonLeads += 1;
    } else if (lead.status !== LeadStatus.LOST) {
      owner.openLeads += 1;
    }
  }

  for (const lead of wonLeads) {
    const ownerId = lead.closedByUserId ?? lead.assignedUserId;
    if (!ownerId) continue;
    const owner = ownerMap.get(ownerId);
    if (!owner) continue;
    owner.revenue += getLeadValue(lead);
  }

  return Array.from(ownerMap.values())
    .filter((item) => item.totalLeads > 0 || item.wonLeads > 0 || item.revenue > 0)
    .sort((a, b) => b.totalLeads - a.totalLeads || b.revenue - a.revenue);
}

function buildConversationBreakdown(conversations: Array<{ state: string; ownerUserId: string | null; memory?: Prisma.JsonValue }>) {
  return [
    { key: "bot", label: "Chatbot ativo", count: conversations.filter(isBotActive).length },
    { key: "assumed", label: "Assumidas", count: conversations.filter((conversation) => Boolean(conversation.ownerUserId)).length },
    { key: "finished", label: "Finalizadas", count: conversations.filter((conversation) => conversation.state === "FINISHED").length },
    { key: "unavailable", label: "Sem viabilidade", count: conversations.filter((conversation) => conversation.state === "FINISHED_UNAVAILABLE").length },
  ];
}

function buildTaskOwners(users: Array<{ id: string; name: string }>, appointments: Array<{ responsibleId: string | null; status: string }>) {
  const taskMap = new Map<string, { userId: string; userName: string; total: number; completed: number; pending: number }>();

  for (const user of users) {
    taskMap.set(user.id, {
      userId: user.id,
      userName: user.name,
      total: 0,
      completed: 0,
      pending: 0,
    });
  }

  for (const appointment of appointments) {
    if (!appointment.responsibleId) continue;
    const taskOwner = taskMap.get(appointment.responsibleId);
    if (!taskOwner) continue;
    taskOwner.total += 1;
    if (appointment.status === "Concluido") {
      taskOwner.completed += 1;
    } else {
      taskOwner.pending += 1;
    }
  }

  return Array.from(taskMap.values())
    .filter((item) => item.total > 0)
    .sort((a, b) => b.completed - a.completed || b.total - a.total);
}

function buildExpenseBreakdown(expenses: Array<{ amount: Prisma.Decimal; status: ExpenseStatus }>) {
  return Object.values(ExpenseStatus).map((status) => ({
    status,
    label: expenseStatusLabels[status],
    count: expenses.filter((expense) => expense.status === status).length,
    totalAmount: expenses.filter((expense) => expense.status === status).reduce((sum, expense) => sum + Number(expense.amount), 0),
  }));
}

function buildTimeline(input: {
  filters: OverviewFilters;
  leads: Array<{ createdAt: Date }>;
  wonLeads: Array<{ wonAt: Date | null; updatedAt: Date }>;
  conversations: Array<{ updatedAt: Date }>;
  appointments: Array<{ updatedAt: Date; status: string }>;
  expenses: Array<{ createdAt: Date; amount: Prisma.Decimal }>;
}) {
  const buckets = createBuckets(input.filters.from, input.filters.to);

  for (const lead of input.leads) {
    applyToBucket(buckets, lead.createdAt, (bucket) => {
      bucket.leads += 1;
    });
  }

  for (const lead of input.wonLeads) {
    applyToBucket(buckets, lead.wonAt ?? lead.updatedAt, (bucket) => {
      bucket.sales += 1;
    });
  }

  for (const conversation of input.conversations) {
    applyToBucket(buckets, conversation.updatedAt, (bucket) => {
      bucket.conversations += 1;
    });
  }

  for (const appointment of input.appointments) {
    if (appointment.status !== "Concluido") continue;
    applyToBucket(buckets, appointment.updatedAt, (bucket) => {
      bucket.tasks += 1;
    });
  }

  for (const expense of input.expenses) {
    applyToBucket(buckets, expense.createdAt, (bucket) => {
      bucket.expenses += Number(expense.amount);
    });
  }

  return buckets.map(({ key: _key, ...bucket }) => bucket);
}

type TimelineBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
  leads: number;
  sales: number;
  conversations: number;
  tasks: number;
  expenses: number;
};

function createBuckets(from: Date, to: Date) {
  const diffDays = Math.max(1, Math.ceil((endOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000) + 1);
  const mode = diffDays > 120 ? "month" : diffDays > 45 ? "week" : "day";
  const buckets: TimelineBucket[] = [];
  let cursor = startOfDay(from);

  while (cursor <= to) {
    const start = new Date(cursor);
    let end = endOfDay(cursor);
    let label = formatDayLabel(start);

    if (mode === "week") {
      end = endOfDay(addDays(start, 6));
      label = `${formatDayLabel(start)}-${formatDayLabel(end)}`;
    }

    if (mode === "month") {
      end = endOfDay(new Date(start.getFullYear(), start.getMonth() + 1, 0));
      label = start.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    }

    if (end > to) {
      end = endOfDay(to);
    }

    buckets.push({
      key: `${start.toISOString()}-${end.toISOString()}`,
      label,
      start,
      end,
      leads: 0,
      sales: 0,
      conversations: 0,
      tasks: 0,
      expenses: 0,
    });

    if (mode === "day") {
      cursor = addDays(start, 1);
    } else if (mode === "week") {
      cursor = addDays(start, 7);
    } else {
      cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    }
  }

  return buckets;
}

function applyToBucket(
  buckets: TimelineBucket[],
  value: Date,
  updater: (bucket: TimelineBucket) => void,
) {
  const bucket = buckets.find((item) => value >= item.start && value <= item.end);
  if (bucket) {
    updater(bucket);
  }
}

function buildLeadAccessWhere(user?: LeadAccessUser): Prisma.LeadWhereInput {
  const sourceWhere = leadSourceWhere(user);
  if (user?.role === "EMPLOYEE") {
    return { assignedUserId: user.id, ...sourceWhere };
  }
  return sourceWhere;
}

function buildWonLeadAccessWhere(user?: LeadAccessUser): Prisma.LeadWhereInput {
  const sourceWhere = leadSourceWhere(user);
  if (user?.role === "EMPLOYEE") {
    return {
      ...sourceWhere,
      OR: [
        { assignedUserId: user.id },
        { closedByUserId: user.id },
      ],
    };
  }
  return sourceWhere;
}

function buildConversationAccessWhere(user?: LeadAccessUser): Prisma.ChatConversationWhereInput {
  return { ...conversationAgentWhere(user), ...(user?.role === "EMPLOYEE" ? {
    OR: [{ ownerUserId: user.id }, { lead: { assignedUserId: user.id } }],
  } : {}) };
}

function buildAppointmentAccessWhere(user?: Pick<User, "id" | "role">): Prisma.AppointmentWhereInput {
  if (user?.role === "EMPLOYEE") {
    return {
      OR: [
        { responsibleId: user.id },
        { createdById: user.id },
        { assignedToAll: true },
      ],
    };
  }
  return {};
}

function buildExpenseAccessWhere(_user?: Pick<User, "id" | "role">): Prisma.ExpenseWhereInput {
  return {};
}

function getLeadValue(lead: { planValue?: Prisma.Decimal | null; expectedValue?: Prisma.Decimal | null; plan?: { price: Prisma.Decimal } | null }) {
  return Number(lead.planValue ?? lead.expectedValue ?? lead.plan?.price ?? 0);
}

function formatRangeLabel(from: Date, to: Date) {
  return `${from.toLocaleDateString("pt-BR")} até ${to.toLocaleDateString("pt-BR")}`;
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function isBotActive(conversation: {state:string;ownerUserId:string|null;memory?:Prisma.JsonValue}) {
  const memory=conversation.memory && typeof conversation.memory === "object" && !Array.isArray(conversation.memory) ? conversation.memory : {};
  return !conversation.ownerUserId && !memory.humanTakeover && !memory.blocked && !["MANUAL","HUMAN_HANDOFF","BLOCKED","FINISHED","FINISHED_UNAVAILABLE"].includes(conversation.state);
}
