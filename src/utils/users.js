import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, "../../data/users.json");

function defaultPreferences() {
  return {
    enabledScanners: null,
    emailDigest: true,
    slackNotify: false,
    theme: "dark",
  };
}

/**
 * @param {object | null} user
 * @returns {object | null}
 */
function sanitizeUser(user) {
  if (!user || typeof user !== "object") return null;
  const { passwordHash: _ph, githubToken: _gt, ...rest } = user;
  return rest;
}

function ensureDataDir() {
  try {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  } catch (err) {
    console.error("users: ensureDataDir failed:", err?.message ?? err);
    throw err;
  }
}

/**
 * @returns {object[]}
 */
function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("users: loadUsers failed:", err?.message ?? err);
    return [];
  }
}

/**
 * @param {object[]} users
 */
function saveUsers(users) {
  try {
    ensureDataDir();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
  } catch (err) {
    console.error("users: saveUsers failed:", err?.message ?? err);
    throw err;
  }
}

/**
 * @param {string} password
 * @returns {string}
 */
export function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function usernameKey(username) {
  return String(username ?? "").trim().toLowerCase();
}

function adminCount(users) {
  return users.filter((u) => u && u.role === "admin").length;
}

/**
 * @returns {object[]}
 */
export function listUsers() {
  try {
    return loadUsers().map((u) => sanitizeUser(u));
  } catch (err) {
    console.error("users: listUsers failed:", err?.message ?? err);
    return [];
  }
}

/**
 * Full user for internal use (includes passwordHash and githubToken when present).
 * @param {string} id
 * @returns {object | null}
 */
export function getUser(id) {
  try {
    const users = loadUsers();
    const user = users.find((u) => u.id === id);
    return user ? { ...user } : null;
  } catch (err) {
    console.error("users: getUser failed:", err?.message ?? err);
    return null;
  }
}

/**
 * @param {string} username
 * @returns {object | null}
 */
export function getUserByUsername(username) {
  try {
    const key = usernameKey(username);
    if (!key) return null;
    const users = loadUsers();
    const user = users.find((u) => usernameKey(u.username) === key);
    return user ? { ...user } : null;
  } catch (err) {
    console.error("users: getUserByUsername failed:", err?.message ?? err);
    return null;
  }
}

/**
 * @param {{ username: string, password: string, role?: string, email?: string | null }} input
 * @returns {object}
 */
export function createUser({ username, password, role = "viewer", email = null }) {
  try {
    const uname = String(username ?? "").trim();
    if (!uname) {
      throw new Error("username is required");
    }
    if (password == null || String(password) === "") {
      throw new Error("password is required");
    }

    const users = loadUsers();
    if (users.some((u) => usernameKey(u.username) === usernameKey(uname))) {
      throw new Error("Username already exists");
    }

    if (role !== "admin" && role !== "viewer") {
      throw new Error('role must be "admin" or "viewer"');
    }

    const passwordHash = hashPassword(String(password));
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      username: uname,
      passwordHash,
      role,
      githubToken: null,
      email: email == null ? null : String(email),
      preferences: defaultPreferences(),
      createdAt: now,
      lastLoginAt: null,
    };

    users.push(user);
    saveUsers(users);
    return sanitizeUser(user);
  } catch (err) {
    const msg = err?.message ?? "";
    if (
      msg === "Username already exists" ||
      msg === "username is required" ||
      msg === "password is required" ||
      msg.startsWith('role must be "admin"')
    ) {
      throw err;
    }
    console.error("users: createUser failed:", msg);
    throw err;
  }
}

/**
 * @param {string} id
 * @param {object} updates
 * @returns {object | null}
 */
export function updateUser(id, updates) {
  if (updates && typeof updates === "object" && Object.prototype.hasOwnProperty.call(updates, "role")) {
    if (updates.role !== "admin" && updates.role !== "viewer") {
      throw new Error('role must be "admin" or "viewer"');
    }
  }

  try {
    if (!updates || typeof updates !== "object") {
      return sanitizeUser(getUser(id));
    }

    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;

    const current = users[idx];
    const next = { ...current };

    if (Object.prototype.hasOwnProperty.call(updates, "email")) {
      next.email = updates.email == null ? null : String(updates.email);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "role")) {
      next.role = updates.role;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "password")) {
      if (updates.password == null || String(updates.password) === "") {
        throw new Error("password cannot be empty");
      }
      next.passwordHash = hashPassword(String(updates.password));
    }
    if (Object.prototype.hasOwnProperty.call(updates, "preferences")) {
      const prefs = updates.preferences;
      next.preferences = {
        ...defaultPreferences(),
        ...(current.preferences && typeof current.preferences === "object" ? current.preferences : {}),
        ...(prefs && typeof prefs === "object" ? prefs : {}),
      };
    }

    users[idx] = next;
    saveUsers(users);
    return sanitizeUser(next);
  } catch (err) {
    const msg = err?.message ?? "";
    if (msg === "password cannot be empty" || msg.startsWith('role must be "admin"')) {
      throw err;
    }
    console.error("users: updateUser failed:", msg);
    return null;
  }
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function deleteUser(id) {
  try {
    const users = loadUsers();
    const target = users.find((u) => u.id === id);
    if (!target) return false;

    if (target.role === "admin" && adminCount(users) <= 1) {
      return false;
    }

    const next = users.filter((u) => u.id !== id);
    saveUsers(next);
    return true;
  } catch (err) {
    console.error("users: deleteUser failed:", err?.message ?? err);
    return false;
  }
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {object | null}
 */
export function validateCredentials(username, password) {
  try {
    const uname = String(username ?? "").trim();
    if (!uname || password == null) return null;

    const users = loadUsers();
    const user = users.find((u) => usernameKey(u.username) === usernameKey(uname));
    if (!user || !user.passwordHash) return null;

    const candidate = hashPassword(String(password));
    if (candidate !== user.passwordHash) return null;

    const updated = { ...user, lastLoginAt: new Date().toISOString() };
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx !== -1) {
      users[idx] = updated;
      saveUsers(users);
    }

    return sanitizeUser(updated);
  } catch (err) {
    console.error("users: validateCredentials failed:", err?.message ?? err);
    return null;
  }
}
