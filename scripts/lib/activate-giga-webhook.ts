export async function activateGigaWebhook(config: { instanceName: string; apiUrl: string; apiKey: string }, webhookUrl: string, request: typeof fetch = fetch) {
  if (config.instanceName !== "GIGA CLICK") throw new Error("Este procedimento ativa somente GIGA CLICK.");
  const readiness = await request(webhookUrl, { signal: AbortSignal.timeout(10000) });
  const ready = await readiness.json();
  if (!readiness.ok || ready.data?.isolationVersion !== 1) throw new Error("Publicação com isolamento ainda não está ativa. Webhook da GIGA não foi ligado.");
  const probe = await request(webhookUrl, {
    method: "POST", headers: { "content-type": "application/json", apikey: config.apiKey },
    body: JSON.stringify({ instance: config.instanceName, event: "integration.validation", data: {} }), signal: AbortSignal.timeout(10000),
  });
  if (!probe.ok) throw new Error("Credencial ou agente GIGA não está pronto na publicação. Webhook não foi ligado.");
  const state = await request(`${config.apiUrl}/instance/connectionState/${encodeURIComponent(config.instanceName)}`, { headers: { apikey: config.apiKey }, signal: AbortSignal.timeout(10000) });
  if (!state.ok || (await state.json()).instance?.state !== "open") throw new Error("GIGA CLICK não está conectada. Webhook não foi ligado.");
  const response = await request(`${config.apiUrl}/webhook/set/${encodeURIComponent(config.instanceName)}`, {
    method: "POST", headers: { "content-type": "application/json", apikey: config.apiKey },
    body: JSON.stringify({ webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false,
      headers: { apikey: config.apiKey }, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "PRESENCE_UPDATE"] } }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Não foi possível ativar o webhook da GIGA (${response.status}).`);
}
