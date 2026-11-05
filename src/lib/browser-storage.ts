export function sessionValue(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } }
export function storeSessionValue(key: string, value: string) { try { sessionStorage.setItem(key, value); } catch { /* Current operation can continue without persistence. */ } }
export function removeSessionValue(key: string) { try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ } }
