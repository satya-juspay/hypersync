#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { refresh } from "../src/refresh.mjs";

const usage = `Usage:
  hypersync refresh

Requires HYPERSYNC_URL, HYPERSYNC_IMPORT_TOKEN and BITBUCKET_TOKEN.
Run on the office network.`;

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (command === "--help" || command === "help" || command === undefined) {
  console.log(usage);
  process.exit(command ? 0 : 1);
}
if (command !== "refresh") {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (args.length) {
  console.error("The refresh command does not accept arguments");
  process.exit(1);
}

refresh().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
