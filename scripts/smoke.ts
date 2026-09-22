// `npm run smoke`. Asks production whether it works, and exits non-zero if it does not.
//
// It checks PRODUCTION_URL from lib/production.ts and nothing else. It takes no argument and
// reads no environment variable for the address, so it cannot be pointed at a dev server or a
// preview deployment, and a pass here is only ever a statement about production. If a redirect
// lands it anywhere else, lib/smoke/check.ts fails it.
//
// Two attempts, a short pause apart, so one dropped connection does not open an issue. A page
// that is broken is broken on both; the second attempt's answer is the one reported.
//
// With SMOKE_REPORT set, it also writes what it found as Markdown to that path, which
// .github/workflows/smoke.yml posts to an issue when the check fails.

import { appendFileSync, writeFileSync } from "node:fs";
import { checkProductionPage, type SmokeResponse, type SmokeResult } from "../lib/smoke/check";
import { PRODUCTION_URL } from "../lib/production";

const ATTEMPTS = 2;
const PAUSE_MS = 15_000;
const TIMEOUT_MS = 30_000;

async function fetchProduction(): Promise<SmokeResponse> {
  // A query string no cache has seen, so the answer is the one a reader gets now, not one a
  // CDN kept from before the deployment.
  const url = new URL(PRODUCTION_URL);
  url.searchParams.set("smoke", Date.now().toString());
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "caddie-smoke (+https://github.com/fieldjw96/caddie)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { url: response.url, status: response.status, body: await response.text() };
  } catch (error) {
    // No response at all. Reported as status 0 so it fails on the status line with the rest.
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`No response from production: ${reason}`);
    return { url: url.toString(), status: 0, body: "" };
  }
}

function report(result: SmokeResult, status: number): string {
  const lines = [
    `Smoke check against production, ${PRODUCTION_URL}, at ${new Date().toISOString()}.`,
    "",
    `- HTTP status: ${status === 0 ? "no response" : status}`,
    `- Tournament named: ${result.tournament ?? "none"}`,
    `- Player rows: ${result.players}`,
    "",
  ];
  if (result.failures.length === 0) {
    lines.push("**Passed.**");
  } else {
    lines.push("**Failed:**", "", ...result.failures.map((f) => `- ${f}`));
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    console.error(
      `smoke takes no argument. It checks production, ${PRODUCTION_URL}, and nothing else, so that a pass can only ever mean production works. Change lib/production.ts if production has moved.`,
    );
    process.exit(2);
  }

  console.log(`Checking production: ${PRODUCTION_URL}`);
  let response: SmokeResponse | undefined;
  let result: SmokeResult | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) {
      console.log(`Attempt ${attempt - 1} failed. Trying again in ${PAUSE_MS / 1000}s.`);
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
    response = await fetchProduction();
    result = checkProductionPage(response);
    if (result.failures.length === 0) break;
  }
  if (!response || !result) throw new Error("unreachable: at least one attempt is made");

  const text = report(result, response.status);
  console.log(text);
  if (process.env.SMOKE_REPORT) writeFileSync(process.env.SMOKE_REPORT, text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);

  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.log(`::error title=Production smoke check failed::${failure}`);
    }
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
