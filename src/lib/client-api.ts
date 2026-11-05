import { toast } from "sonner";
/** Bounded, buffered JSON requests. Never retry mutations with uncertain delivery. */
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number | null = null) { super(message); this.name = "ApiRequestError"; }
}
export async function fetchApi(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = init.method && init.method !== "GET" ? 55_000 : 25_000) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await response.text();
    let payload: { status?: string; message?: string } | null = null;
    if (body.trim()) {
      try { payload = JSON.parse(body); }
      catch { throw new ApiRequestError(`O servidor retornou uma resposta inválida (${response.status}).`, response.status); }
    }
    if (!response.ok || payload?.status === "error") throw new ApiRequestError(payload?.message || `Falha na operação (${response.status}).`, response.status);
    if (!body.trim() && response.status !== 204) throw new ApiRequestError("O servidor retornou uma resposta vazia.", response.status);
    return new Response(response.status === 204 ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    if (timedOut) throw new ApiRequestError("O servidor demorou para responder. Confira se a operação foi concluída antes de repetir.");
    if (error instanceof ApiRequestError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new ApiRequestError("Não foi possível conectar. Confira sua conexão e tente novamente.");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}
export const apiErrorMessage = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação.";

export function reportApiError(error: unknown) { toast.error(apiErrorMessage(error), { duration: 6000 }); }
