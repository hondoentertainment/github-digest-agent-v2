import fs from "fs";
import path from "path";

/**
 * Write file atomically: temp in same dir, then rename (same filesystem).
 * @param {string} filePath
 * @param {string} content
 */
export function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * @param {string} filePath
 * @param {unknown} json
 */
export function atomicWriteJson(filePath, json) {
  atomicWriteFile(filePath, JSON.stringify(json, null, 2));
}
