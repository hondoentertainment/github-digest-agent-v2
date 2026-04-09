import cron from "node-cron";
import dotenv from "dotenv";
dotenv.config();

import { runDigest } from "./index.js";

// Import server to start it (side-effect: starts Express)
import "./server.js";

const schedule = process.env.CRON_SCHEDULE || "0 7 * * *";

console.log(`⏰ Digest cron scheduled: ${schedule}`);

// Run immediately on start if --now flag is passed
if (process.argv.includes("--now")) {
  console.log("🏃 Running digest immediately (--now flag)...\n");
  runDigest().catch(console.error);
}

cron.schedule(schedule, () => {
  console.log(`\n⏰ Cron triggered at ${new Date().toLocaleString()}`);
  runDigest().catch(console.error);
});
