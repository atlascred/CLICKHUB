export type TemplateComponent = { type: string; format?: string; text?: string; buttons?: Array<{ type: string; url?: string }> };
export type OfficialTemplate = { id: string; name: string; language: string; status: string; parameter_format?: string; components: TemplateComponent[] };
export function templateFields(template: OfficialTemplate) {
  return template.components.flatMap(component => {
    if (!["HEADER", "BODY"].includes(component.type)) return [];
    return [...new Set([...String(component.text || "").matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(match => match[1]))]
      .map(name => ({ key: `${component.type}:${name}`, name, component: component.type.toLowerCase() }));
  });
}
export function templateUnsupportedReason(template: OfficialTemplate) {
  if (template.components.some(c => !["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(c.type))) return "Este tipo de modelo ainda não é compatível com campanhas.";
  if (template.components.some(c => c.type === "HEADER" && c.format && !["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(c.format))) return "Cabeçalho não compatível com campanhas.";
  if (template.components.some(c => c.buttons?.some(b => !["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(b.type) || /\{\{/.test(b.url || "")))) return "Use um modelo sem botões dinâmicos nesta campanha.";
  return "";
}
export function buildTemplatePayload(template: OfficialTemplate, values: Record<string, string>, mediaUrl?: string) {
  if (template.status !== "APPROVED") throw new Error("Selecione um modelo aprovado pela Meta.");
  const unsupported = templateUnsupportedReason(template);
  if (unsupported) throw new Error(unsupported);
  const fields = templateFields(template);
  if (fields.some(field => typeof values[field.key] !== "string" || !values[field.key].trim() || values[field.key].length > 1024)) throw new Error("Preencha todas as variáveis do modelo (até 1.024 caracteres).");
  const components: Array<Record<string, unknown>> = [];
  for (const type of ["header", "body"]) {
    const parameters = fields.filter(f => f.component === type).map(f => ({ type: "text", text: values[f.key].trim(), ...(template.parameter_format === "NAMED" ? { parameter_name: f.name } : {}) }));
    if (parameters.length) components.push({ type, parameters });
  }
  const header = template.components.find(c => c.type === "HEADER");
  if (header?.format && ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format)) {
    let url: URL;
    try { url = new URL(mediaUrl || ""); } catch { throw new Error("Informe o endereço HTTPS da mídia do modelo."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Informe o endereço HTTPS da mídia do modelo.");
    const type = header.format.toLowerCase();
    components.push({ type: "header", parameters: [{ type, [type]: { link: url.href } }] });
  }
  return { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) };
}
