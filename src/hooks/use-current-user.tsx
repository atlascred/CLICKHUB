"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useApiResource } from "@/hooks/use-api-resource";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "EMPLOYEE";
  status: "ACTIVE" | "BLOCKED";
  permissions: Record<string, boolean>;
  avatarUrl: string | null;
  theme: string;
};

type CurrentUserResource = ReturnType<typeof useApiResource<CurrentUser>>;
const CurrentUserContext = createContext<CurrentUserResource | null>(null);
const storageKey = "click-hubnet-current-user";

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const resource = useApiResource<CurrentUser>("/api/auth/me");
  const [cachedUser, setCachedUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(storageKey);
      if (cached) setCachedUser(JSON.parse(cached) as CurrentUser);
    } catch {
      try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
    }
  }, []);

  useEffect(() => {
    if (!resource.data) return;
    setCachedUser(resource.data);
    try { sessionStorage.setItem(storageKey, JSON.stringify(resource.data)); } catch { /* Keep the authenticated session usable without browser storage. */ }
  }, [resource.data]);

  const { statusCode, setData } = resource;
  useEffect(() => {
    if (statusCode === 401 || statusCode === 403) {
      setCachedUser(null); setData(null); clearCurrentUserCache();
    }
  }, [statusCode, setData]);

  return (
    <CurrentUserContext.Provider value={{ ...resource, data: resource.data ?? cachedUser }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function clearCurrentUserCache() {
  try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
}

export function useCurrentUser() {
  const context = useContext(CurrentUserContext);
  if (!context) throw new Error("useCurrentUser deve ser utilizado dentro de CurrentUserProvider.");
  return context;
}
