import { overLimit } from '../_limit.js';
import { statsStart, writeStat } from '../_admin-events.js';

const kinds = new Set(['wallet_created', 'transfer_submitted', 'transfer_test_submitted']);

export async function onRequestPost({ request, env }) {
  const origin = 'https://wallet.tavarov.com';
  if (new URL(request.url).origin !== origin || request.headers.get('Origin') !== origin) {
    return new Response(null, { status: 403 });
  }
  if (!env.ADMIN_STATS || statsStart(env) === null) return new Response(null, { status: 204 });
  if (await overLimit(request, env, 'webaudit', 20, 60)) {
    return new Response(null, { status: 429 });
  }
  if (!request.body) return new Response(null, { status: 400 });
  const reader = request.body.getReader();
  const buffer = new Uint8Array(256);
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (size + value.byteLength > buffer.length) {
      await reader.cancel();
      return new Response(null, { status: 400 });
    }
    buffer.set(value, size);
    size += value.byteLength;
  }
  let event;
  try { event = JSON.parse(new TextDecoder().decode(buffer.subarray(0, size))); } catch { return new Response(null, { status: 400 }); }
  if (!kinds.has(event?.kind) || typeof event.id !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(event.id)) return new Response(null, { status: 400 });
  await writeStat(env, event.kind, event.kind + ':' + event.id);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
