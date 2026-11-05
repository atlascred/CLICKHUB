/** Localidades BTU supplied by the owner on 05/11/2026. Match city AND UF. */
export const nioBtuCities: Record<string, readonly string[]> = {
  AL: ['Arapiraca', 'Maceió'],
  BA: ['Eunápolis', 'Feira de Santana', 'Ilhéus', 'Itabuna', 'Jequié', 'Juazeiro', 'Lauro de Freitas', 'Luís Eduardo Magalhães', 'Paulo Afonso', 'Simões Filho', 'Vitória da Conquista'],
  CE: ['Juazeiro do Norte'],
  ES: ['Cachoeiro de Itapemirim'],
  GO: ['Catalão', 'Formosa', 'Inhumas', 'Morrinhos', 'Senador Canedo', 'Trindade'],
  MA: ['Imperatriz'],
  MG: ['Araguari', 'Caxambu', 'Coronel Fabriciano', 'Governador Valadares', 'Ipatinga', 'Itabira', 'João Monlevade', 'Lavras', 'Montes Claros', 'Muriaé', 'Paracatu', 'Patrocínio', 'Poços de Caldas', 'Sabará', 'Santa Rita do Sapucaí', 'Timóteo'],
  MS: ['Maracaju'],
  MT: ['Barra do Garças', 'Juína', 'Pontes e Lacerda', 'Tangará da Serra'],
  PA: ['Castanhal', 'Marabá'],
  PB: ['João Pessoa'],
  PE: ['Caruaru', 'Petrolina'],
  PI: ['Parnaíba'],
  PR: ['Apucarana', 'Arapongas', 'Astorga', 'Cambé', 'Campina Grande do Sul', 'Campo Largo', 'Campo Mourão', 'Cianorte', 'Colorado', 'Cornélio Procópio', 'Foz do Iguaçu', 'Francisco Beltrão', 'Guarapuava', 'Guaratuba', 'Ibiporã', 'Irati', 'Jandaia do Sul', 'Marechal Cândido Rondon', 'Medianeira', 'Palmas', 'Quatro Barras', 'São Pedro do Ivaí', 'São Sebastião da Amoreira', 'Toledo', 'Umuarama', 'União da Vitória'],
  RJ: ['Campos dos Goytacazes', 'Nova Friburgo', 'Paracambi', 'Resende', 'Saquarema'],
  RN: ['Natal'],
  RO: ['Cacoal', 'Jaru', 'Rolim de Moura'],
  RS: ['Alegrete', 'Bagé', 'Bento Gonçalves', 'Camaquã', 'Campo Bom', 'Carazinho', 'Eldorado do Sul', 'Erechim', 'Estância Velha', 'Farroupilha', 'Flores da Cunha', 'Garibaldi', 'Ijuí', 'Lajeado', 'Marau', 'Rio Grande', 'Rio Pardo', 'Rosário do Sul', 'Santiago', 'Taquara', 'Uruguaiana'],
  SC: ['Balneário Camboriú', 'Chapecó', 'Criciúma', 'Guabiruba', 'Içara', 'Indaial', 'Ituporanga', 'Palhoça', 'Rio do Sul', 'São José'],
  SE: ['Itabaiana'],
  SP: ['Campinas', 'Guarulhos', 'Jundiaí', 'Mogi das Cruzes', 'São José dos Campos', 'Sorocaba', 'Votorantim'],
  TO: ['Gurupi', 'Paraíso do Tocantins'],
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
const cities = new Set(Object.entries(nioBtuCities).flatMap(([uf, names]) => names.map(city => `${uf}:${normalize(city)}`)));
export function nioCityTier(city?: string | null, uf?: string | null): 'btu' | 'normal' | null {
  if (!city?.trim() || !uf || !'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(uf.trim().toUpperCase())) return null;
  return cities.has(`${uf.trim().toUpperCase()}:${normalize(city)}`) ? 'btu' : 'normal';
}
export type NioPricingPolicy = { version: 1; btuPlanIds: string[]; normalPlanIds: string[] };
export function nioPricingPolicy(agent?: { zapiInstanceId?: string | null; rules?: unknown } | null): NioPricingPolicy | null {
  if (agent?.zapiInstanceId !== 'CLICK') return null;
  const rules = agent.rules && typeof agent.rules === 'object' ? agent.rules as Record<string, unknown> : {};
  const value = rules.nioRegionalPricing as Partial<NioPricingPolicy> | undefined;
  if (value?.version !== 1 || !Array.isArray(value.btuPlanIds) || !Array.isArray(value.normalPlanIds)) return null;
  return value as NioPricingPolicy;
}
export function nioRegionalPlans<T extends { id: string }>(agent: Parameters<typeof nioPricingPolicy>[0], memory: { city?: string; state?: string }, plans: T[]): T[] {
  const policy = nioPricingPolicy(agent);
  if (!policy) return plans;
  const tier = nioCityTier(memory.city, memory.state);
  if (!tier) return [];
  const ids = tier === 'btu' ? policy.btuPlanIds : policy.normalPlanIds;
  return ids.flatMap(id => { const plan = plans.find(plan => plan.id === id); return plan ? [plan] : []; });
}
export function isNioPriceQuestion(text: string) {
  const value = normalize(text);
  return /(?:PRECO|VALOR|MENSALIDADE|CARO|PROMOCAO|DESCONTO|ANUNCIO)/.test(value)
    && /(?:DIFERENT|ANUNCIO|PROMOCAO|DESCONTO|POR ?QUE|PORQUE|MAIS CARO|AUMENT)/.test(value);
}
export const nioNormalPlans = [
  { name: '600 MEGA', speed: '600 Mega', price: 110, description: 'Internet Fibra 600 Mega', order: 1 },
  { name: '800 MEGA + CHIP 10GB', speed: '800 Mega', price: 140, description: 'Internet Fibra 800 Mega\nCHIP 10 GB', order: 2 },
  { name: '1 GIGA + CHIP 20GB + GLOBOPLAY', speed: '1 Giga', price: 170, description: 'Internet Fibra 1 Giga\nCHIP 20 GB\nGloboplay grátis', order: 3 },
  { name: '1 GIGA + 2 CHIPS 20GB + GLOBOPLAY', speed: '1 Giga', price: 200, description: 'Internet Fibra 1 Giga\n2 CHIPS 20 GB\nGloboplay grátis', order: 4 },
];
