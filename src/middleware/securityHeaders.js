export function securityHeaders() {
  return (req, res, next) => {
    // Prevent XSS
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "0"); // Modern approach: disable legacy filter

    // Referrer policy
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // Permissions policy (restrict browser features)
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // HSTS (only if behind TLS proxy)
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    // Remove server fingerprint
    res.removeHeader("X-Powered-By");

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join("; ");
    res.setHeader("Content-Security-Policy", csp);

    next();
  };
}
