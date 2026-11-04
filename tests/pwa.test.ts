import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function worker(offline = false) {
  const listeners: Record<string, (event: any) => void> = {};
  const cached: string[] = [];
  const fetched: any[] = [];
  const deleted: string[] = [];
  let skipped = false;
  let claimed = false;
  const fallback = { offline: true };
  const cache = { addAll: async (paths: string[]) => { cached.push(...paths); }, match: async (path: string) => path === '/offline.html' ? fallback : undefined };
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL, Response,
    self: { location: { origin: 'https://crm.test' }, addEventListener: (name: string, callback: any) => { listeners[name] = callback; }, skipWaiting: () => { skipped = true; }, clients: { claim: async () => { claimed = true; } } },
    caches: { open: async () => cache, keys: async () => ['clickhub-pwa-static-v0', 'clickhub-pwa-static-v1', 'unrelated-cache'], delete: async (name: string) => { deleted.push(name); } },
    fetch: async (...args: any[]) => { fetched.push(args); if (offline) throw new Error('Offline'); return { online: true }; },
  });
  const request = (path: string, options: any = {}) => {
    let response: Promise<any> | undefined;
    listeners.fetch({ request: { url: new URL(path, 'https://crm.test').href, method: 'GET', mode: 'cors', headers: new Headers(), ...options }, respondWith: (value: Promise<any>) => { response = value; } });
    return response;
  };
  return { listeners, cached, fetched, deleted, fallback, request, skipped: () => skipped, claimed: () => claimed };
}

test('PWA caches only public assets, and updates wait for an explicit action', async () => {
  const sw = worker();
  let done: Promise<any> | undefined;
  sw.listeners.install({ waitUntil: (promise: Promise<any>) => { done = promise; } });
  await done;
  assert.deepEqual(sw.cached, ['/offline.html', '/pwa/apple-touch-icon.png', '/pwa/icon-192.png', '/pwa/icon-512.png']);
  assert.equal(sw.skipped(), false);
  sw.listeners.activate({ waitUntil: (promise: Promise<any>) => { done = promise; } });
  await done;
  assert.deepEqual(sw.deleted, ['clickhub-pwa-static-v0']);
  assert.equal(sw.claimed(), true);
  sw.listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(sw.skipped(), true);
});

test('PWA leaves API calls, changes, RSC and external requests to the browser', () => {
  const sw = worker(true);
  for (const path of ['/api/leads', '/api/auth/login', '/api/profile', '/api/whatsapp/conversations']) {
    assert.equal(sw.request(path), undefined);
    assert.equal(sw.request(path, { method: 'POST' }), undefined);
  }
  assert.equal(sw.request('/leads', { method: 'PUT' }), undefined);
  assert.equal(sw.request('/leads', { headers: new Headers({ RSC: '1' }) }), undefined);
  assert.equal(sw.request('/leads?_rsc=abc'), undefined);
  assert.equal(sw.request('https://other.test/pwa/icon-192.png'), undefined);
  assert.equal(sw.request('/_next/static/app.js'), undefined);
  assert.equal(sw.fetched.length, 0);
});

test('PWA serves fresh online documents without caching customer pages', async () => {
  const sw = worker();
  assert.deepEqual(await sw.request('/leads', { mode: 'navigate' }), { online: true });
  assert.equal(sw.fetched[0][1].cache, 'no-store');
  assert.deepEqual(sw.cached, []);
});

test('PWA shows a generic offline page when navigation fails', async () => {
  const sw = worker(true);
  assert.equal(await sw.request('/leads', { mode: 'navigate' }), sw.fallback);
  assert.deepEqual(sw.cached, []);
});
