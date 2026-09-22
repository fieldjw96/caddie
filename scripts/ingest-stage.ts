// `npm run ingest:stage -- <stage>` runs one stage of the production ingest, as
// .github/workflows/ingest.yml does: the stage's own npm script, with every line it prints
// redacted before it is shown or kept. See lib/ingest/redact.ts for why.
//
// The redacted output is shown as it arrives and appended to `<INGEST_LOG_DIR>/<stage>.log`,
// which the workflow's last step checks for anything that still looks like a credential. A
// stage that fails says which stage it was, as a GitHub error annotation and a line in the job
// summary, and exits with the script's own code, so the run stops there and a courses failure
// never reads the same as a results failure.

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { redact, secretsFrom } from "../lib/ingest/redact";
import { STAGES } from "../lib/ingest/stages";

const name = process.argv.slice(2).join(" ");
const stage = STAGES.find((s) => s.name === name);
if (!stage) {
  console.error(
    `"${name}" is not a stage. The stages are: ${STAGES.map((s) => s.name).join(", ")}.`,
  );
  process.exit(2);
}

const secrets = secretsFrom(process.env.DATABASE_URL);
const logDir = process.env.INGEST_LOG_DIR;
const logFile = logDir ? join(logDir, `${stage.name.replace(/\s+/g, "-")}.log`) : null;
if (logDir) mkdirSync(logDir, { recursive: true });

function summarise(line: string): void {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${line}\n`);
}

function show(line: string, to: NodeJS.WriteStream): void {
  const safe = redact(line, secrets);
  to.write(`${safe}\n`);
  if (logFile) appendFileSync(logFile, `${safe}\n`);
}

// Through a shell on Windows only, where npm is npm.cmd. The script name is one of this repo's
// own constants, never input.
const args = ["run", "--silent", stage.script];
const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];
const child =
  process.platform === "win32"
    ? spawn(["npm", ...args].join(" "), { stdio, shell: true })
    : spawn("npm", args, { stdio });
const streams = [
  new Promise<void>((resolve) =>
    createInterface({ input: child.stdout })
      .on("line", (l) => show(l, process.stdout))
      .on("close", resolve),
  ),
  new Promise<void>((resolve) =>
    createInterface({ input: child.stderr })
      .on("line", (l) => show(l, process.stderr))
      .on("close", resolve),
  ),
];

child.on("error", (error) => {
  show(`Could not start npm run ${stage.script}: ${error.message}`, process.stderr);
  console.log(`::error title=Ingest stage failed::The ${stage.name} stage could not start.`);
  process.exitCode = 1;
});

child.on("close", async (code, signal) => {
  await Promise.all(streams);
  const status = code ?? 1;
  if (status === 0) {
    summarise(`| ${stage.name} | \`${stage.script}\` | passed |`);
    return;
  }
  const how = signal ? `was killed by ${signal}` : `exited ${status}`;
  console.log(
    `::error title=Ingest stage failed::The ${stage.name} stage (npm run ${stage.script}) ${how}. Nothing after it ran.`,
  );
  summarise(`| ${stage.name} | \`${stage.script}\` | **failed**: ${how} |`);
  process.exitCode = status;
});
