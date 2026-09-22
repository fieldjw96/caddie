// .github/workflows/deploy.yml is the only automated path to production, and nothing runs it
// before it merges: by the time it is wrong, it is wrong on `main`, against the real database.
// So the properties that make it safe are asserted here rather than left to its comments.
//
// It migrates before it deploys, a failed step stops everything after it, it runs for the tip
// of `main` alone, no secret is present while dependencies install, and VERCEL_TOKEN's value
// reaches one step only. See docs/adr/0003, and lib/smoke/workflows.test.ts for the two
// workflows that watch production rather than change it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const DEPLOY = ".github/workflows/deploy.yml";

const stringMap = z.record(z.string(), z.string());

const stepSchema = z.object({
  id: z.string(),
  name: z.string(),
  if: z.string().optional(),
  run: z.string().optional(),
  env: stringMap.optional(),
  "continue-on-error": z.unknown().optional(),
});

const workflowSchema = z.object({
  on: z.record(z.string(), z.unknown()),
  env: stringMap.optional(),
  permissions: stringMap,
  concurrency: z.object({
    group: z.string(),
    "cancel-in-progress": z.boolean(),
  }),
  jobs: z.record(
    z.string(),
    z.object({
      if: z.string(),
      environment: z.string(),
      "timeout-minutes": z.number(),
      env: stringMap.optional(),
      steps: z.array(stepSchema),
    }),
  ),
});

const source = read(DEPLOY);
const workflow = workflowSchema.parse(parse(source));
const jobs = Object.values(workflow.jobs);
const job = jobs[0]!;
type Step = z.infer<typeof stepSchema>;

function step(id: string): Step {
  const found = job.steps.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no step with id "${id}"`);
  return found;
}

const indexOf = (id: string): number => job.steps.indexOf(step(id));

/** The first step handed any value at all, secret or not. Everything before it is inert. */
const firstWithEnv = job.steps.findIndex((s) => s.env !== undefined);

describe("the deploy workflow", () => {
  it("has exactly one job, so the step order below is the whole story", () => {
    expect(jobs).toHaveLength(1);
  });

  it("is triggered by a push to main and by nothing else", () => {
    expect(workflow.on).toEqual({ push: { branches: ["main"] } });
  });

  it("refuses to run for any other ref even if a trigger is added later", () => {
    // Exact, not `toContain`: `... || true` would contain the right words and guard nothing.
    expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
  });

  it("runs in the production environment, whose secrets are restricted to main", () => {
    expect(job.environment).toBe("production");
  });

  it("queues a second merge behind a run in progress rather than cancelling it", () => {
    // Cancelling between migrating and deploying leaves the two disagreeing.
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    expect(workflow.concurrency.group).toBe("production");
  });

  it("migrates, checks main again, deploys, then smoke checks, in that order", () => {
    const order = [
      "tip_before_migrate",
      "preflight",
      "migrate",
      "tip_before_deploy",
      "deploy",
      "smoke",
    ].map(indexOf);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("puts nothing between the migration and the deploy but the tip-of-main check", () => {
    // Once the schema has moved, anything that fails before the deploy strands it ahead of
    // the running code. The check is the one exception, and it is deliberate.
    const between = job.steps
      .slice(indexOf("migrate") + 1, indexOf("deploy"))
      .map((s) => s.id);
    expect(between).toEqual(["tip_before_deploy"]);
  });

  it("lets nothing run after a failed step except the failure report", () => {
    // This, and nothing else, is what makes "a failed migration means no deploy" true. No
    // conditional to get wrong: a step with an `if:` would run after the migration failed.
    const last = job.steps.at(-1)!;
    expect(last.id).toBe("report");
    // `cancelled()` too: `timeout-minutes` cancels the job rather than failing it, and a run
    // that hangs after migrating is the one that most needs reporting.
    expect(last.if).toBe("failure() || cancelled()");
    expect(job["timeout-minutes"]).toBeGreaterThan(0);

    for (const s of job.steps.slice(0, -1)) {
      expect(s.if, `step "${s.id}" must not have an if:`).toBeUndefined();
      expect(
        s["continue-on-error"],
        `step "${s.id}" must not continue on error`,
      ).toBeUndefined();
    }
  });

  it("names every step in the failure report, so the issue says which one broke", () => {
    const failedStep = step("report").env?.FAILED_STEP ?? "";
    for (const s of job.steps.slice(0, -1)) {
      // A step stopped by a timeout has the outcome `cancelled`, not `failure`.
      expect(failedStep).toContain(
        `(steps.${s.id}.outcome == 'failure' || steps.${s.id}.outcome == 'cancelled') && '${s.name}'`,
      );
    }
    expect(workflow.permissions.issues).toBe("write");
  });
});

describe("the deploy workflow's handling of secrets", () => {
  it("hands no secret to the workflow or the job, only to the steps that need one", () => {
    // `npm ci` runs dependencies' install scripts. A job-level secret would be in their
    // environment, and a package this repo never wrote would be holding it.
    expect(JSON.stringify(workflow.env ?? {})).not.toContain("secrets.");
    expect(JSON.stringify(job.env ?? {})).not.toContain("secrets.");
  });

  it("gives the checkout, setup, install and CLI steps no env at all", () => {
    // No `env` at all, not merely none naming a secret, so nothing can be slipped in beside
    // them later.
    for (const id of ["checkout", "setup_node", "install", "cli"]) {
      expect(step(id).env, `step "${id}" must have no env`).toBeUndefined();
    }
    expect(firstWithEnv).toBeGreaterThan(indexOf("cli"));
  });

  it("gives VERCEL_TOKEN's value to the step that deploys and to no other", () => {
    // The value itself, `${{ secrets.VERCEL_TOKEN }}`, not the preflight's test of whether
    // there is one, `${{ secrets.VERCEL_TOKEN != '' }}`, which is a boolean.
    const holders = job.steps
      .filter((s) =>
        Object.values(s.env ?? {}).some((value) =>
          /^\$\{\{\s*secrets\.VERCEL_TOKEN\s*\}\}$/.test(value),
        ),
      )
      .map((s) => s.id);
    expect(holders).toEqual(["deploy"]);
    expect(step("deploy").env).toEqual({ VERCEL_TOKEN: "${{ secrets.VERCEL_TOKEN }}" });
  });

  it("checks the token is present without ever holding it", () => {
    // `secrets.VERCEL_TOKEN != ''` is the boolean true or false, never the token, so a missing
    // one fails before the migration rather than between the migration and the deploy.
    expect(step("preflight").env?.HAS_VERCEL_TOKEN).toBe("${{ secrets.VERCEL_TOKEN != '' }}");
    expect(step("preflight").run).toContain('if [ "$HAS_VERCEL_TOKEN" != "true" ]');
  });

  it("takes the two Vercel identifiers at job level, since neither is a credential", () => {
    expect(job.env).toEqual({
      VERCEL_ORG_ID: "${{ vars.VERCEL_ORG_ID }}",
      VERCEL_PROJECT_ID: "${{ vars.VERCEL_PROJECT_ID }}",
    });
  });

  it("names no secret but the two this deploy needs", () => {
    const named = new Set([...source.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    expect([...named].sort()).toEqual(["POSTGRES_URL_NON_POOLING", "VERCEL_TOKEN"]);
  });

  it("never echoes a secret's value", () => {
    // Naming one is how the preflight says which is missing; expanding one is the mistake.
    for (const s of job.steps) {
      const run = s.run ?? "";
      expect(run, s.id).not.toMatch(/(echo|printf|cat)[^\n]*\$\{?DATABASE_URL/);
      expect(run, s.id).not.toMatch(/(echo|printf|cat)[^\n]*\$\{?VERCEL_TOKEN/);
      expect(run, s.id).not.toMatch(/(echo|printf)[^\n]*secrets\./);
    }
  });
});

describe("the deploy workflow's refusal to ship a stale commit", () => {
  const before = step("tip_before_migrate");
  const again = step("tip_before_deploy");

  it("checks the commit is still the tip of main before migrating and again before deploying", () => {
    // A re-run keeps the original commit, workflow file and ref, so every main-only guard
    // still passes. Drizzle would apply nothing, and the deploy would ship old code behind
    // the newer schema: a rollback nobody chose.
    expect(again.run).toBe(before.run);
    expect(before.run).toContain(
      "git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main",
    );
    expect(before.run).toContain('if [ "$main_sha" != "$GITHUB_SHA" ]; then');
    expect(before.run).toContain("exit 1");
    // Both SHAs named in the failure, so the log says which run to re-run instead.
    expect(before.run).toMatch(/::error[^\n]*\$GITHUB_SHA[^\n]*\$main_sha/);
  });

  it("makes the first check the last thing before a secret is touched", () => {
    for (const s of [before, again]) {
      expect(s.env, `step "${s.id}" must hold no secret`).toBeUndefined();
    }
    expect(indexOf("tip_before_migrate")).toBeLessThan(firstWithEnv);
  });
});

describe("the deploy workflow's preflight", () => {
  const run = step("preflight").run ?? "";

  it("runs before the migration, so a missing credential changes nothing", () => {
    expect(indexOf("preflight")).toBeLessThan(indexOf("migrate"));
  });

  it("names each missing secret or identifier, and how to set it", () => {
    for (const [name, command] of [
      ["POSTGRES_URL_NON_POOLING", "gh secret set POSTGRES_URL_NON_POOLING --env production"],
      ["VERCEL_TOKEN", "gh secret set VERCEL_TOKEN --env production"],
      ["VERCEL_ORG_ID", "gh variable set VERCEL_ORG_ID --env production"],
      ["VERCEL_PROJECT_ID", "gh variable set VERCEL_PROJECT_ID --env production"],
    ] as const) {
      const message = run
        .split("\n")
        .find((line) => line.includes(`::error`) && line.includes(command));
      expect(message, `no error message tells a reader how to set ${name}`).toBeDefined();
    }
  });

  it("reports every missing piece at once rather than stopping at the first", () => {
    // Setting one secret, re-merging, and being told about the next is three red runs where
    // one would do.
    expect(run).toContain("failed=yes");
    expect(run).toContain('if [ -n "$failed" ]');
  });

  it("refuses a pooled connection, because DDL does not survive one", () => {
    expect(run).toContain("*pgbouncer=true* | *:6543/*)");
  });
});

describe("the deploy workflow's migration", () => {
  it("runs the same script the ingest's first stage runs, on the direct connection", () => {
    const migrate = step("migrate");
    expect(migrate.run).toBe("npm run db:migrate");
    expect(migrate.env).toEqual({
      DATABASE_URL: "${{ secrets.POSTGRES_URL_NON_POOLING }}",
    });
  });

  it("is the only migration a push to main sets off", () => {
    // migrate.yml used to run on push as well, which put an unordered second migration beside
    // this one. It keeps workflow_dispatch and workflow_call, which the ingest needs.
    const migrateWorkflow = read(".github/workflows/migrate.yml")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(migrateWorkflow).not.toMatch(/^ {2}push:/m);
    expect(migrateWorkflow).toMatch(/^ {2}workflow_dispatch:/m);
    expect(migrateWorkflow).toMatch(/^ {2}workflow_call:/m);
  });
});

describe("the deploy workflow's Vercel CLI", () => {
  const PINNED = /vercel@\d+\.\d+\.\d+/;

  it("is installed pinned, by a step that holds nothing, before any secret is set", () => {
    const install = step("cli").run ?? "";
    expect(install).toMatch(PINNED);
    expect(install).toContain('--prefix "$RUNNER_TEMP/vercel-cli"');
    expect(indexOf("cli")).toBeLessThan(firstWithEnv);
  });

  it("is never fetched by npx, which would resolve its dependencies beside the token", () => {
    // npx pins only the top-level package; the rest resolve at run time, and their install
    // scripts would run inside the step holding VERCEL_TOKEN.
    for (const s of job.steps) {
      // Case-insensitive, so `npx "$VERCEL_CLI"` is caught as well as `npx vercel@...`.
      expect(s.run ?? "", `step "${s.id}" must not npx the CLI`).not.toMatch(
        /npx[^\n]*vercel/i,
      );
    }
  });

  it("is not a dependency of this repo, whose audit would then never be green", () => {
    // The CLI's own tree carries standing high and critical advisories. `npm audit
    // --audit-level=high` is a required check, and it is about what the app ships.
    const pkg = z
      .object({
        dependencies: z.record(z.string(), z.string()),
        devDependencies: z.record(z.string(), z.string()),
      })
      .parse(JSON.parse(read("package.json")));
    expect(pkg.dependencies).not.toHaveProperty("vercel");
    expect(pkg.devDependencies).not.toHaveProperty("vercel");
  });

  it("is only ever run from where that step put it", () => {
    // Every invocation of the CLI, by the path it is invoked through. A bare `vercel` would
    // be whatever the runner image happens to have, at whatever version.
    const paths = job.steps
      .flatMap((s) => (s.run ?? "").split("\n"))
      .filter((line) => !line.trimStart().startsWith("#"))
      .flatMap((line) => [
        ...line.matchAll(/([^\s=(]*vercel[^\s]*)\s+(deploy|env|--version)\b/g),
      ])
      .map((match) => match[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toBe('"$RUNNER_TEMP/vercel-cli/node_modules/.bin/vercel"');
    }
  });

  it("deploys to production and waits for it, rather than promoting later", () => {
    // `--prod` does not return until the production domain points at the new deployment, so
    // the smoke check below reaches this deployment and not the previous one.
    expect(step("deploy").run).toContain("deploy --prod --yes");
  });
});

describe("the deploy workflow's smoke check", () => {
  it("runs after the deploy and fails the workflow with it", () => {
    expect(indexOf("smoke")).toBe(indexOf("deploy") + 1);
    expect(step("smoke")["continue-on-error"]).toBeUndefined();
    expect(step("smoke").if).toBeUndefined();
  });

  it("runs the existing check, which carries production's address itself", () => {
    // scripts/smoke.ts takes no address, so nothing here can pass by checking a preview
    // deployment or a dev server. lib/smoke/workflows.test.ts holds the address to one file.
    expect(step("smoke").run).toBe("npm run smoke");
    expect(source).not.toMatch(/https?:\/\/[^\s"']*vercel\.app/);
  });
});

describe("vercel.json", () => {
  it("stops Vercel's Git integration deploying on push, even if it is reconnected", () => {
    const config = z
      .object({ git: z.object({ deploymentEnabled: z.literal(false) }) })
      .safeParse(JSON.parse(read("vercel.json")));
    expect(config.success).toBe(true);
  });
});
