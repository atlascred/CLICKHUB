import { commercialPlans } from '../scripts/lib/commercial-plans';
import { gigaCommercialPlans } from '../scripts/lib/giga-commercial-plans';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function isolatedDatabase() {
  const agents = [
    { id: 'agent-click', name: 'Lily', zapiInstanceId: 'CLICK', active: true, deletedAt: null, minTypingSeconds: 0, maxTypingSeconds: 0, enableTyping: false, enableReplyDelay: false },
    { id: 'agent-giga', name: 'Lily', zapiInstanceId: 'GIGA CLICK', active: true, deletedAt: null, minTypingSeconds: 0, maxTypingSeconds: 0, enableTyping: false, enableReplyDelay: false },
  ];
  const plans = [...commercialPlans.map((p,i) => ({ ...p, id: `click-plan-${i}`, agentId: agents[0].id, active: true, deletedAt: null })), ...gigaCommercialPlans.map((p,i) => ({ ...p, id: `giga-plan-${i}`, agentId: agents[1].id, active: true, deletedAt: null }))];
  const conversations: any[] = []; const messages: any[] = []; const leads: any[] = []; const settings = new Map<string, any>();
  function matches(c: any, where: any = {}): boolean {
    if (where.id !== undefined && c.id !== where.id) return false;
    if (where.phone !== undefined && c.phone !== where.phone) return false;
    if (where.agentId !== undefined && c.agentId !== where.agentId) return false;
    if (where.deletedAt === null && c.deletedAt != null) return false;
    if (where.OR) return where.OR.some((x: any) => x.state?.in?.includes(c.state) || (x.memory?.path && c.memory[x.memory.path[0]] === x.memory.equals));
    return true;
  }
  const db: any = {
    agent: {
      create: async ({ data }: any) => { const a = { id: `agent-new-${agents.length}`, deletedAt: null, ...copy(data) }; agents.push(a); return copy({ ...a, plans: [] }); },
      update: async ({ where, data }: any) => { const a = agents.find(a => a.id === where.id); if (a) { const { plans: _links, ...fields } = data; Object.assign(a, copy(fields)); } return copy(a); },
      findMany: async ({ where }: any) => agents.filter(a => !where?.zapiInstanceId || a.zapiInstanceId === where.zapiInstanceId).map(a => ({ ...a, plans: plans.filter(p => p.agentId === a.id) })),
    },
    plan: {
      findMany: async ({ where }: any) => copy(plans.filter(p => !where?.agents?.some?.id || p.agentId === where.agents.some.id)),
      findFirst: async ({ where }: any) => { const p = plans.find(p => p.name === where.name && p.agentId === where.agents.some.id); return p ? copy({ ...p, agents: [{ id: p.agentId }] }) : null; },
      create: async ({ data }: any) => { const p = { ...copy(data), id: `new-plan-${plans.length}`, agentId: data.agents.connect.id }; plans.push(p); return copy(p); },
      update: async ({ where, data }: any) => { const p = plans.find(p => p.id === where.id); if (p) Object.assign(p, copy(data)); return copy(p); },
    },
    chatConversation: {
      updateMany: async ({ where, data }: any) => { let count = 0; for (const c of conversations) if (matches(c, where)) { Object.assign(c, copy(data)); count++; } return { count }; },
      findFirst: async ({ where }: any) => {
        const found = conversations.find(c => matches(c, where)); return found ? copy({ ...found, messages: messages.filter(m => m.conversationId === found.id).slice(-10).reverse() }) : null;
      },
      findUnique: async ({ where }: any) => copy(conversations.find(c => c.id === where.id) ?? null),
      findMany: async ({ where }: any) => copy(conversations.filter(c => matches(c, where))),
      create: async ({ data }: any) => {
        const c = { id: `conversation-${conversations.length}`, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), memory: {}, state: 'START', ...copy(data), messages: [] };
        conversations.push(c); return copy(c);
      },
      update: async ({ where, data }: any) => { const c = conversations.find(c => c.id === where.id); Object.assign(c, copy(data)); return copy(c); },
    },
    chatMessage: {
      findFirst: async ({ where }: any) => {
        const found = messages.find(m => {
          if (where.direction && m.direction !== where.direction) return false;
          if (where.OR) return where.OR.some((x: any) => x.providerId === m.providerId || x.rawPayload?.array_contains?.some((id: string) => m.rawPayload?.inReplyTo?.includes(id)));
          return where.providerId === m.providerId;
        }); return found ? copy(found) : null;
      },
      create: async ({ data }: any) => {
        if (data.providerId && messages.some(m => m.providerId === data.providerId)) throw new Error('Duplicate fixture id');
        const m = { id: `message-${messages.length}`, createdAt: new Date(), ...copy(data) }; messages.push(m); return copy(m);
      },
    },
    appSetting: {
      findUnique: async ({ where }: any) => copy(settings.get(where.key) ?? null),
      upsert: async ({ where, create, update }: any) => { const row = settings.has(where.key) ? { ...settings.get(where.key), ...copy(update) } : copy(create); settings.set(where.key, row); return row; },
    },
    lead: {
      create: async ({ data }: any) => { const row = { id: `lead-${leads.length}`, ...copy(data) }; leads.push(row); return copy(row); },
      findUnique: async ({ where }: any) => copy(leads.find(l => l.id === where.id) ?? null),
      findFirst: async () => null,
    },
    $queryRaw: async () => [],
    $executeRaw: async (_parts: any, ...values: any[]) => {
      const [state, memory, leadId, id] = values;
      const c = conversations.find(c => c.id === id);
      if (!c || c.memory.humanTakeover || c.memory.blocked || ['MANUAL','BLOCKED','FINISHED','HUMAN_HANDOFF'].includes(c.state)) return 0;
      c.state = state; c.memory = JSON.parse(memory); if (leadId) c.leadId = leadId; return 1;
    },
    $transaction: async (operation: any) => Array.isArray(operation) ? Promise.all(operation) : operation(db),
  };
  return { db, agents, plans, conversations, messages, leads, settings };
}
