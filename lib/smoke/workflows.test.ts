// .github/workflows/migrate.yml and smoke.yml only run on main and against production, so
// nothing exercises them before they merge. These read them as text and hold them to what
// they exist for, and hold the production address to living in one file.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_URL } from "../production";

const root = process.cwd();

/** A workflow without its comments, which are allowed to say anything. */
function workflow(name: string): string {
  return readFileSync(join(root, ".github/workflows", name), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

const secretsIn = (code: string) =>
  [...new Set([...code.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort();

describe("the migrate workflow", () => {
  const code = workflow("migrate.yml");

  it("runs by hand and when another workflow calls it, but not on a push", () => {
    // A push to main is deploy.yml's, which migrates as the step before it deploys. A push
    // trigger here would race it. lib/deploy/workflow.test.ts asserts the other half.
    expect(code).not.toMatch(/^ {2}push:/m);
    expect(code).toMatch(/^ {2}workflow_dispatch:/m);
    expect(code).toMatch(/^ {2}workflow_call:/m);
  });

  it("runs in the production environment, whose secret no other job can read", () => {
    expect(code).toMatch(/^ {4}environment: production$/m);
  });

  it("gives DATABASE_URL the direct connection and nothing else", () => {
    expect(secretsIn(code)).toEqual(["POSTGRES_URL_NON_POOLING"]);
    const assignments = [...code.matchAll(/^\s*DATABASE_URL:\s*(.+)$/gm)].map((m) =>
      m[1]?.trim(),
    );
    expect(assignments).toEqual(["${{ secrets.POSTGRES_URL_NON_POOLING }}"]);
  });

  it("migrates with the same script the ingest's first stage runs", () => {
    expect(code).toMatch(/^\s*- run: npm run db:migrate$/m);
  });

  it("never echoes the connection string", () => {
    expect(code).not.toMatch(/(echo|printf)[^\n]*\$\{?DATABASE_URL/);
    expect(code).not.toMatch(/(echo|printf)[^\n]*secrets\./);
  });

  it("is what the daily ingest runs first, and no stage starts until it has passed", () => {
    const ingest = workflow("ingest.yml");
    expect(ingest).toMatch(/^ {2}migrate:\n {4}uses: \.\/\.github\/workflows\/migrate\.yml$/m);
    expect(ingest).toMatch(/^ {2}ingest:\n {4}needs: migrate$/m);
  });
});

describe("the smoke workflow", () => {
  const code = workflow("smoke.yml");

  it("runs after a deployment, on a schedule and by hand", () => {
    expect(code).toMatch(/^ {2}deployment_status:/m);
    expect(code).toMatch(/^ {4}- cron: "\d+ \* \* \* \*"$/m);
    expect(code).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("checks after a Production deployment only", () => {
    expect(code).toContain("github.event.deployment_status.state == 'success'");
    expect(code).toContain("github.event.deployment.environment == 'Production'");
  });

  it("runs the smoke check with no address of its own", () => {
    expect(code).toMatch(/^\s*run: npm run smoke$/m);
    expect(code).not.toMatch(/https?:\/\/[^\s"']*vercel\.app/);
    expect(code).not.toContain("environment_url");
  });

  it("opens or updates an issue when it fails, and needs no secret to", () => {
    expect(code).toMatch(/if: failure\(\) && steps\.smoke\.outcome == 'failure'/);
    expect(code).toContain("gh issue create");
    expect(code).toContain("gh issue comment");
    expect(code).toMatch(/^ {2}issues: write$/m);
    expect(secretsIn(code)).toEqual([]);
  });
});

describe("the production address", () => {
  const SKIP = new Set([".git", "node_modules", ".next", "coverage", "fixtures"]);

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (SKIP.has(name)) return [];
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }

  it("is a real https origin", () => {
    const url = new URL(PRODUCTION_URL);
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/");
  });

  it("is written in lib/production.ts and nowhere else", () => {
    const host = new URL(PRODUCTION_URL).host;
    const holders = files(root)
      .filter((path) => readFileSync(path, "utf8").includes(host))
      .map((path) => relative(root, path).split(sep).join("/"));
    expect(holders).toEqual(["lib/production.ts"]);
  });
});
