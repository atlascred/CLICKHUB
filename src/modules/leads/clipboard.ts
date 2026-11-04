export type LeadCopyKind = "consulta" | "venda";

export type LeadCopyData = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  cpfCnpj?: string | null;
  birthDate?: string | Date | null;
  cep?: string | null;
  address?: string | null;
  streetNumber?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  planName?: string | null;
  plan?: { name: string } | null;
  billingDueDay?: number | null;
};

const text = (value?: string | null) => value?.trim() ?? "";

function birthDate(value: LeadCopyData["birthDate"]) {
  if (!value) return "";
  const raw = value instanceof Date ? (Number.isNaN(value.getTime()) ? "" : value.toISOString()) : value;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : /^\d{2}\/\d{2}\/\d{4}$/.test(raw) ? raw : "";
}

export function buildLeadCopyText(lead: LeadCopyData, kind: LeadCopyKind) {
  const digits = text(lead.cpfCnpj).replace(/\D/g, "");
  const documentLabel = digits.length === 14 ? "CNPJ" : "CPF";
  const document = digits.length === 11
    ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
    : digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : text(lead.cpfCnpj);
  const cepDigits = text(lead.cep).replace(/\D/g, "");
  const cep = cepDigits.length === 8 ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : text(lead.cep);
  const complement = /^sem complemento$/i.test(text(lead.complement)) ? "" : text(lead.complement);
  const street = text(lead.address), number = text(lead.streetNumber);
  const cityState = [text(lead.city), text(lead.state)].filter(Boolean).join("/");
  const customer = [`👤 Nome: ${text(lead.name)}`, `🆔 ${documentLabel}: ${document}`, `🎂 Nascimento: ${birthDate(lead.birthDate)}`];

  if (kind === "consulta") {
    const address = [[street, number].filter(Boolean).join(" "), text(lead.neighborhood), text(lead.city), text(lead.state), complement].filter(Boolean).join(" - ");
    return ["CONSULTA:", "", ...customer, "", `📍 CEP: ${cep}`, `🏠 Endereço: ${address}`].join("\n");
  }

  let phone = text(lead.phone).replace(/\D/g, "");
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  const addressBase = [street, number ? `nº ${number}` : "", complement, text(lead.neighborhood)].filter(Boolean).join(", ");
  const address = [addressBase, cityState].filter(Boolean).join(" – ");
  return [
    "SUBIR VENDA:", "", `🛜 PLANO: ${text(lead.planName) || text(lead.plan?.name)}`,
    customer[0], "👤 Nome da Mãe: ", `📲 WhatsApp: ${phone}`, customer[1], customer[2],
    `📧 E-mail: ${text(lead.email)}`, `📍 CEP: ${cep}`, `🏠 Endereço: ${address}`,
    `📅 Vencimento: ${lead.billingDueDay ? `Dia ${lead.billingDueDay}` : ""}`,
  ].join("\n");
}
