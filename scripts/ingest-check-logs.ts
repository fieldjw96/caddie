// `npm run ingest:check-logs` reads every log a stage kept in INGEST_LOG_DIR and fails if any
// of them still shows the connection string, its password, or any credential at all. The last
// step of .github/workflows/ingest.yml, and it runs whether or not the stages passed: a
// failed stage is the likeliest one to have printed a driver error with a URL in it.
//
// It names the file and what kind of thing leaked, never the thing itself.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findLeaks, secretsFrom } from "../lib/ingest/redact";

const dir = process.env.INGEST_LOG_DIR;
if (!dir) {
  console.error("INGEST_LOG_DIR is not set, so there are no logs to check.");
  process.exit(1);
}

const secrets = secretsFrom(process.env.DATABASE_URL);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".log")) : [];
let leaked = 0;
for (const file of files) {
  for (const leak of new Set(findLeaks(readFileSync(join(dir, file), "utf8"), secrets))) {
    console.log(`::error title=Credential in ingest log::${file}: ${leak}.`);
    leaked += 1;
  }
}

if (leaked > 0) {
  console.error(`${leaked} credential leak(s) found across ${files.length} stage log(s).`);
  process.exitCode = 1;
} else {
  console.log(`No credential appears in any of ${files.length} stage log(s).`);
}
