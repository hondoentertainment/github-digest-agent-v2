const counters = {
  requestsTotal: 0,
  scansStarted: 0,
  scansCompleted: 0,
  scansFailed: 0,
  digestsSent: 0,
  apiErrors: 0,
  webhooksReceived: 0,
};

export function incScanStarted() {
  counters.scansStarted++;
}

export function incScanCompleted() {
  counters.scansCompleted++;
}

export function incScanFailed() {
  counters.scansFailed++;
}

export function incDigestSent() {
  counters.digestsSent++;
}

export function incWebhook() {
  counters.webhooksReceived++;
}

export function incApiError() {
  counters.apiErrors++;
}

export function getMetrics() {
  return { ...counters, uptimeSeconds: Math.floor(process.uptime()) };
}

export function metricsMiddleware() {
  return (req, res, next) => {
    counters.requestsTotal++;
    next();
  };
}
