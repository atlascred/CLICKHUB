// The simulator must never reach a real database, WhatsApp or AI endpoint.
require('tsx/cjs');
const Module = require('node:module');
const load = Module._load;
const forbiddenDatabase = new Proxy({}, { get() { throw new Error('Real database disabled in chatbot simulation'); } });
Module._load = function (name, ...args) {
  if (name === 'server-only') return {};
  if (name === '@/lib/prisma' || /src\/lib\/prisma(?:\.ts)?$/.test(name)) return { prisma: forbiddenDatabase };
  return load.call(this, name, ...args);
};
global.fetch = async () => { throw new Error('Real network disabled in chatbot simulation'); };
