export function requestLogger() {
  return (req, res, next) => {
    const start = Date.now();
    const { method, url, ip } = req;

    // Attach listener for when response finishes
    res.on("finish", () => {
      const duration = Date.now() - start;
      const status = res.statusCode;

      // Skip health checks and static assets from logging
      if (url === "/api/status" || (!url.startsWith("/api/") && method === "GET")) return;

      const level = status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO";
      const timestamp = new Date().toISOString();

      console.log(
        JSON.stringify({
          timestamp,
          level,
          method,
          url: url.split("?")[0], // strip query params for cleanliness
          status,
          duration: `${duration}ms`,
          ip: ip || req.connection?.remoteAddress,
        })
      );
    });

    next();
  };
}
