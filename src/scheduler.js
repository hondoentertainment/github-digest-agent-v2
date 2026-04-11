import cron from "node-cron";
import dotenv from "dotenv";
dotenv.config();

import { runDigest } from "./index.js";
import { withScanLock } from "./utils/scanLock.js";
import { saveScan } from "./utils/storage.js";

import "./server.js";

const schedule = process.env.CRON_SCHEDULE || "0 7 * * *";

console.log(`⏰ Digest cron scheduled: ${schedule}`);

async function scheduledDigest() {
  try {
    // runDigest() already calls sendNotifications() internally
    const result = await withScanLock(() => runDigest());
    saveScan(result);
  } catch (err) {
    if (err.status === 409) {
      console.warn("⏭️ Skipping scheduled digest — scan already in progress");
    } else {
      console.error("❌ Scheduled digest failed:", err);
    }
  }
}

if (process.argv.includes("--now")) {
  console.log("🏃 Running digest immediately (--now flag)...\n");
  scheduledDigest();
}

cron.schedule(schedule, () => {
  console.log(`\n⏰ Cron triggered at ${new Date().toLocaleString()}`);
  scheduledDigest();
});
