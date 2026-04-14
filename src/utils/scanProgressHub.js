/** @type {Set<import("ws").WebSocket>} */
const clients = new Set();

/**
 * @param {import("ws").WebSocket} ws
 */
export function registerScanProgressClient(ws) {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
}

/**
 * @param {Record<string, unknown>} payload
 */
export function broadcastScanProgress(payload) {
  const raw = JSON.stringify({ type: "scan_progress", ...payload });
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try {
        ws.send(raw);
      } catch {
        clients.delete(ws);
      }
    }
  }
}

export function scanProgressClientCount() {
  return clients.size;
}
