import dotenv from "dotenv";
dotenv.config();

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

export function authMiddleware(req, res, next) {
  if (!DASHBOARD_PASSWORD) return next();

  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token === DASHBOARD_PASSWORD) return next();
  }

  const apiKey = req.headers["x-api-key"];
  if (apiKey === DASHBOARD_PASSWORD) return next();

  res.status(401).json({ status: "unauthorized", message: "Invalid or missing API key." });
}

export function isAuthEnabled() {
  return !!DASHBOARD_PASSWORD;
}
