import dotenv from "dotenv";
import { verifySessionToken, signSessionToken as signJwt, getJwtSecret } from "../services/jwtTokens.js";
import { hasUsers } from "../utils/users.js";

dotenv.config();

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

export function isAuthEnabled() {
  return Boolean(DASHBOARD_PASSWORD?.trim()) || hasUsers();
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function authMiddleware(req, res, next) {
  if (!isAuthEnabled()) {
    req.auth = { sub: "anon", role: "admin", username: null };
    return next();
  }

  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "")?.trim();
  const apiKey = typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"].trim() : "";

  const tryToken = bearer || apiKey;
  if (tryToken) {
    const jwtPayload = verifySessionToken(tryToken);
    if (jwtPayload) {
      req.auth = {
        sub: jwtPayload.sub,
        role: jwtPayload.role,
        username: jwtPayload.username,
      };
      return next();
    }
  }

  if (DASHBOARD_PASSWORD) {
    if (bearer === DASHBOARD_PASSWORD || apiKey === DASHBOARD_PASSWORD) {
      const signed = signSessionToken({ sub: "env", role: "admin", username: null });
      if (signed) {
        req.auth = { sub: "env", role: "admin", username: null };
        return next();
      }
      req.auth = { sub: "env", role: "admin", username: null };
      return next();
    }
  }

  res.status(401).json({ status: "unauthorized", message: "Invalid or missing credentials." });
}

export function signSessionToken(payload) {
  return signJwt(payload);
}

export { verifySessionToken, getJwtSecret };
