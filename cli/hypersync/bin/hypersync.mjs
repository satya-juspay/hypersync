#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverUiComponents } from "../src/discover-ui-components.mjs";
import { inspectUiComponents } from "../src/inspect-ui-components.mjs";
import { refreshUiComponents } from "../src/refresh-ui-components.mjs";
import { refresh } from "../src/refresh.mjs";

const usage = `Usage:
  hypersync refresh
  hypersync discover-ui-components
  hypersync inspect-ui-components
  hypersync refresh-ui-components

Both refresh commands require HYPERSYNC_URL, HYPERSYNC_IMPORT_TOKEN and BITBUCKET_TOKEN.
Discovery and inspection require only BITBUCKET_TOKEN and never change the database.
Run on the office network.`;

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (command === "--help" || command === "help" || command === undefined) {
  console.log(usage);
  process.exit(command ? 0 : 1);
}
if (!["refresh", "discover-ui-components", "inspect-ui-components", "refresh-ui-components"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (args.length) {
  console.error(`${command} does not accept arguments`);
  process.exit(1);
}

const commands = {
  refresh,
  "refresh-ui-components": refreshUiComponents,
  "discover-ui-components": discoverUiComponents,
  "inspect-ui-components": inspectUiComponents,
};
const readOnly = command === "discover-ui-components" || command === "inspect-ui-components";
const run = readOnly
  ? commands[command](undefined, { onProgress: (message) => console.error(message) }).then((releases) => {
      console.log(JSON.stringify({ releases }, null, 2));
      if (releases.some((release) => release.error)) process.exitCode = 1;
    })
  : commands[command]();

run.catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
