export function safeRedirectPath(value: string | null, fallback: string) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const base = "https://crm.invalid";
    const url = new URL(value, base);
    return url.origin === base ? url.pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}
