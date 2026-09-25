#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { backfillMainFingerprints, refresh } from "../src/refresh.mjs";

const usage = `Usage:
  hypersync refresh [--fingerprints N]
  hypersync backfill-main-fingerprints [--limit N]

Requires HYPERSYNC_URL, HYPERSYNC_IMPORT_TOKEN and BITBUCKET_TOKEN.
Run on the office network.`;

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (command === "--help" || command === "help" || command === undefined) {
  console.log(usage);
  process.exit(command ? 0 : 1);
}
if (!["refresh", "backfill-main-fingerprints"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (command === "backfill-main-fingerprints") {
  let limit = Infinity;
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--limit" || !/^[1-9]\d*$/.test(args[1])) {
      console.error("Expected --limit N, where N is greater than zero");
      process.exit(1);
    }
    limit = Number(args[1]);
  }
  backfillMainFingerprints({ limit }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
} else {
  let fingerprintLimit = 20;
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--fingerprints" || !/^\d+$/.test(args[1])) {
      console.error("Expected --fingerprints N");
      process.exit(1);
    }
    fingerprintLimit = Number(args[1]);
    if (fingerprintLimit > 50) {
      console.error("--fingerprints must be 0 to 50");
      process.exit(1);
    }
  }

  refresh({ fingerprintLimit }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
