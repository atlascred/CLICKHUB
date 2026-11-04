"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

export function PwaProvider() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const reloadRequested = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const onControllerChange = () => {
      if (reloadRequested.current) window.location.reload();
    };
    const onStateChange = () => {
      if (!disposed && installing?.state === "installed" && navigator.serviceWorker.controller) {
        setWaiting(registration?.waiting ?? null);
        setDismissed(false);
      }
    };
    const onUpdateFound = () => {
      installing?.removeEventListener("statechange", onStateChange);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", onStateChange);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((result) => {
      if (disposed) return;
      registration = result;
      setWaiting(result.waiting);
      registration.addEventListener("updatefound", onUpdateFound);
      onUpdateFound();
    }).catch(() => {
      // The online CRM remains usable when a browser disables service workers.
    });
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      registration?.removeEventListener("updatefound", onUpdateFound);
      installing?.removeEventListener("statechange", onStateChange);
    };
  }, []);

  if (!waiting || dismissed) return null;
  return <div role="status" className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] mx-auto flex max-w-md items-center gap-3 rounded-2xl border bg-card p-3 text-card-foreground shadow-xl">
    <p className="min-w-0 flex-1 text-sm">Uma atualização do aplicativo está pronta. Salve o que estiver editando antes de atualizar.</p>
    <button type="button" className="flex min-h-11 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground" onClick={() => { reloadRequested.current = true; waiting.postMessage({ type: "SKIP_WAITING" }); }}><RefreshCw className="h-4 w-4" />Atualizar</button>
    <button type="button" aria-label="Lembrar depois" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-muted" onClick={() => setDismissed(true)}><X className="h-4 w-4" /></button>
  </div>;
}
