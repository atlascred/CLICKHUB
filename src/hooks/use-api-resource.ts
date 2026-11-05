"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { ApiResult } from "@/types/api";
import { ApiRequestError, apiErrorMessage, fetchApi } from "@/lib/client-api";

const inFlightRequests = new Map<string, Promise<string>>();
function requestOnce(url: string) {
  const existing = inFlightRequests.get(url);
  if (existing) return existing;
  const request = fetchApi(url, { cache: "no-store" }).then(response => response.text())
    .finally(() => setTimeout(() => { if (inFlightRequests.get(url) === request) inFlightRequests.delete(url); }, 250));
  inFlightRequests.set(url, request);
  return request;
}
export function useApiResource<T>(url: string) {
  const [resource, setResource] = useState<{ url: string; data: T | null; loading: boolean; error: string | null; statusCode: number | null }>({ url, data: null, loading: true, error: null, statusCode: null });
  const latest = useRef(0);
  const currentUrl = useRef(url);
  currentUrl.current = url;
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    const isCurrent = () => currentUrl.current === url && latest.current === id;
    setResource(previous => ({ url, data: previous.url === url ? previous.data : null, loading: true, error: null, statusCode: null }));
    try {
      const result = JSON.parse(await requestOnce(url)) as ApiResult<T>;
      if (!isCurrent()) return;
      if (result.status !== "success") throw new ApiRequestError(result.message || "Resposta inválida.");
      setResource({ url, data: result.data, loading: false, error: null, statusCode: null });
    } catch (error) {
      if (isCurrent()) setResource(previous => ({ ...previous, loading: false, error: apiErrorMessage(error), statusCode: error instanceof ApiRequestError ? error.status : null }));
    }
  }, [url]);
  useEffect(() => { void refresh(); return () => { latest.current++; }; }, [refresh]);
  const setData = useCallback((next: SetStateAction<T | null>) => {
    setResource(previous => ({ ...previous, data: typeof next === "function" ? (next as (value: T | null) => T | null)(previous.data) : next }));
  }, []);
  const matches = resource.url === url;
  return { data: matches ? resource.data : null, loading: !matches || resource.loading, error: matches ? resource.error : null, statusCode: matches ? resource.statusCode : null, refresh, setData };
}
