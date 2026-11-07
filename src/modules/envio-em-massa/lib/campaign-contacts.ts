import { normalizePhone } from "@/services/validators";

export const MAX_OFFICIAL_CAMPAIGN_CONTACTS = 10_000;
// Allows formatted numbers and duplicates without accepting an unbounded payload.
const MAX_CONTACT_TEXT_LENGTH = 1_000_000;
export const OFFICIAL_CAMPAIGN_CONTACT_LIMIT_LABEL = MAX_OFFICIAL_CAMPAIGN_CONTACTS.toLocaleString("pt-BR");

export function uniqueCampaignContacts(text: string) {
  return [...new Set(text.split(/[\r\n;,]+/).map(value => value.trim()).filter(Boolean).map(normalizePhone))];
}

export function campaignContacts(text: string) {
  if (typeof text !== "string" || text.length > MAX_CONTACT_TEXT_LENGTH) throw new Error(`Informe até ${OFFICIAL_CAMPAIGN_CONTACT_LIMIT_LABEL} contatos por campanha. A lista de contatos está muito grande.`);
  const contacts = uniqueCampaignContacts(text);
  if (contacts.some(phone => !/^55\d{10,11}$/.test(phone))) throw new Error("Há números inválidos. Use DDD e número, um contato por linha.");
  if (!contacts.length || contacts.length > MAX_OFFICIAL_CAMPAIGN_CONTACTS) throw new Error(`Informe de 1 a ${OFFICIAL_CAMPAIGN_CONTACT_LIMIT_LABEL} contatos por campanha.`);
  return contacts;
}
