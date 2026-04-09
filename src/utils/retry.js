const DEFAULTS = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
};

export async function withRetry(fn, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  let lastError;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.maxRetries) break;

      const retryDelay = getRetryDelay(err, attempt, opts);
      if (retryDelay === null) break;

      console.warn(
        `Attempt ${attempt + 1}/${opts.maxRetries} failed: ${err.message}. ` +
        `Retrying in ${Math.round(retryDelay)}ms...`
      );
      await sleep(retryDelay);
    }
  }

  throw lastError;
}

function getRetryDelay(err, attempt, opts) {
  if (err.status === 429 || isRateLimited(err)) {
    const retryAfter = err.response?.headers?.["retry-after"];
    return retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
  }

  // Client errors (except rate limits) are not retryable
  if (err.status && err.status >= 400 && err.status < 500) return null;

  // Exponential backoff with jitter for server/network errors
  const delay = Math.min(opts.baseDelay * Math.pow(2, attempt), opts.maxDelay);
  return delay * (0.5 + Math.random() * 0.5);
}

function isRateLimited(err) {
  return (
    err.status === 403 &&
    err.response?.headers?.["x-ratelimit-remaining"] === "0"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
