export const AGENT_COVERAGE_PREFIX = "agent-coverage:";

/** A missing policy keeps the current agent behavior; malformed policies fail closed. */
export function coverageDataset(agent?: {id:string;rules:unknown} | null): string | undefined {
  const rules=agent?.rules && typeof agent.rules==='object' && !Array.isArray(agent.rules) ? agent.rules as Record<string,unknown> : {};
  const policy=rules.coveragePolicy;
  if(policy===undefined)return undefined;
  if(!policy||typeof policy!=='object'||Array.isArray(policy))throw new Error('Configuração de cobertura inválida.');
  const p=policy as Record<string,unknown>;
  if(p.mode!=='required'||typeof p.dataset!=='string'||!p.dataset.startsWith(`${AGENT_COVERAGE_PREFIX}${agent?.id}:`))throw new Error('Base de cobertura não corresponde ao agente.');
  return p.dataset;
}

export function coverageUnavailable(memory: Record<string,unknown>, cep:string) {
  return {state:'FINISHED_UNAVAILABLE',memory:{...memory,cep},reply:'Infelizmente, no momento ainda não temos cobertura para esse CEP.'};
}
