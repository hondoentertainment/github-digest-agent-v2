let scanInProgress = false;
let lastScanError = null;

export function isScanLocked() {
  return scanInProgress;
}

export function getScanError() {
  return lastScanError;
}

export async function withScanLock(fn) {
  if (scanInProgress) {
    const err = new Error("A scan is already in progress.");
    err.status = 409;
    throw err;
  }

  scanInProgress = true;
  lastScanError = null;

  try {
    return await fn();
  } catch (err) {
    lastScanError = err.message;
    throw err;
  } finally {
    scanInProgress = false;
  }
}
