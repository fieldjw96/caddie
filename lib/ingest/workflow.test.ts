// .github/workflows/ingest.yml is the only thing that writes to production, and nothing runs
// it before it merges. These read it as text and hold it to what the ingest needs: the stages
// in lib/ingest/stages.ts in that order, one secret and no other, a daily schedule.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGES } from "./stages";

const workflow = readFileSync(join(process.cwd(), ".github/workflows/ingest.yml"), "utf8");
/** The workflow without its comments, which are allowed to name anything. */
const code = workflow
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

describe("the ingest workflow", () => {
  it("runs every stage, in dependency order, one step each", () => {
    const run = [...code.matchAll(/scripts\/ingest-stage\.ts (.+)$/gm)].map((m) =>
      m[1]?.trim(),
    );
    expect(run).toEqual(STAGES.map((s) => s.name));
  });

  it("migrates before any ingest", () => {
    expect(STAGES[0]?.script).toBe("db:migrate");
  });

  it("runs on a daily schedule and by hand", () => {
    const crons = [...code.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(crons).toHaveLength(1);
    const [minute, hour, ...rest] = (crons[0] ?? "").split(" ");
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect(rest).toEqual(["*", "*", "*"]);
    expect(code).toMatch(/^\s*workflow_dispatch:/m);
  });

  it("reads CADDIE_DATABASE_URL and no other secret", () => {
    const secrets = new Set([...code.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]));
    expect([...secrets]).toEqual(["CADDIE_DATABASE_URL"]);
  });

  it("gives DATABASE_URL no value but that secret", () => {
    const assignments = [...code.matchAll(/^\s*DATABASE_URL:\s*(.+)$/gm)].map((m) =>
      m[1]?.trim(),
    );
    expect(assignments).toEqual(["${{ secrets.CADDIE_DATABASE_URL }}"]);
    // No other variable anywhere in the workflow looks like a database connection.
    const variables = new Set(
      [
        ...code.matchAll(
          /\b([A-Z0-9_]*(?:DATABASE|POSTGRES|PGHOST|PGUSER|PGPASSWORD)[A-Z0-9_]*)\b/g,
        ),
      ].map((m) => m[1]),
    );
    expect([...variables].sort()).toEqual(["CADDIE_DATABASE_URL", "DATABASE_URL"]);
  });

  it("never echoes the connection string", () => {
    expect(code).not.toMatch(/(echo|printf)[^\n]*\$\{?DATABASE_URL/);
    expect(code).not.toMatch(/(echo|printf)[^\n]*secrets\./);
  });

  it("checks every log for a credential, whether or not the stages passed", () => {
    expect(code).toMatch(/if: always\(\)\s+run: npx tsx scripts\/ingest-check-logs\.ts/);
  });
});
