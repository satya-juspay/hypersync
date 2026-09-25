#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { refresh } from "../src/refresh.mjs";

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (command === "--help" || command === "help" || command === undefined) {
  console.log("Usage: hypersync refresh [--fingerprints N]\n\nRequires HYPERSYNC_URL, HYPERSYNC_IMPORT_TOKEN and BITBUCKET_TOKEN. Run on the office network.");
  process.exit(command ? 0 : 1);
}
if (command !== "refresh") {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

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
