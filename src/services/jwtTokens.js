import crypto from "crypto";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_TEST_SECRET = "vitest-jwt-secret-min-32-chars-long!!";

export function getJwtSecret() {
  const s = process.env.JWT_SECRET?.trim();
  if (s) return s;
  const pw = process.env.DASHBOARD_PASSWORD?.trim();
  if (pw) {
    return crypto.createHash("sha256").update(`jwt:${pw}`, "utf8").digest("hex");
  }
  if (process.env.NODE_ENV === "test") return DEFAULT_TEST_SECRET;
  return null;
}

/**
 * @param {{ sub: string, role: "admin"|"viewer", username?: string }} payload
 * @returns {string|null}
 */
export function signSessionToken(payload) {
  const secret = getJwtSecret();
  if (!secret) return null;
  const expiresIn = process.env.JWT_EXPIRES_IN || "24h";
  return jwt.sign(
    { sub: payload.sub, role: payload.role, username: payload.username ?? null },
    secret,
    { expiresIn }
  );
}

/**
 * @param {string} token
 * @returns {{ sub: string, role: string, username: string | null } | null}
 */
export function verifySessionToken(token) {
  const secret = getJwtSecret();
  if (!secret || !token) return null;
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded !== "object" || !decoded) return null;
    const role = decoded.role === "admin" || decoded.role === "viewer" ? decoded.role : null;
    if (!role || typeof decoded.sub !== "string") return null;
    return {
      sub: decoded.sub,
      role,
      username: typeof decoded.username === "string" ? decoded.username : null,
    };
  } catch {
    return null;
  }
}
