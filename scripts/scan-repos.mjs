#!/usr/bin/env node
import { runScan } from "../src/index.js";
import { saveScan } from "../src/utils/storage.js";

const result = await runScan();
saveScan(result);
console.log(`Scan complete: ${result.meta.totalItems} items across ${result.meta.reposScanned} repos.`);
