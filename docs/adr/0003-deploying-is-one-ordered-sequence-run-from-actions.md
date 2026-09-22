---
status: accepted
---

# Deploying is one ordered sequence, run from Actions

Until this decision, caddie deployed through Vercel's Git integration, and on 2026-09-22 that
produced two failures at once.

It stalled silently. The last deployment Vercel made was `9bad6bd7` at 17:26. Eight commits
landed on `main` after it, including the fix that lets the app read the connection string
Vercel actually provides. Production served code from before that fix for three and a half
hours while every check in the repository was green. Nothing anywhere said the deploy had
stopped, because nothing in this repository was doing the deploying.

And it raced the migration. Vercel began building a push at the same moment `migrate.yml`
began applying that push's migrations. Nothing ordered the two. `migrate.yml` said so in its
own header and pointed at Vercel's Deployment Checks, which is a dashboard setting that no
file here can turn on, verify, or notice the absence of.

## The decision

**Merging to `main` applies pending migrations and then deploys, as steps of one job.**
`.github/workflows/deploy.yml` holds that job: check the commit is still the tip of `main`,
check the production secrets, migrate, check the tip again, deploy, smoke check. The ordering
guarantee is plain step semantics — a failed step skips every step after it — rather than a
conditional that can be written wrong and still look right. A failed migration means no
deploy, and a failed deploy means a red run on the commit and an issue in the queue.

Schema goes first because the other order is the broken one. Code that reads a table the
database lacks fails every request that touches it. A schema one merge ahead of the code is
what an additive migration is written to tolerate.

**Vercel stops deploying this repository.** The Git integration is disconnected in the
dashboard, which is a human step, and `vercel.json` sets `git.deploymentEnabled: false` as a
second belt, so reconnecting it by mistake still does not deploy on push. Preview deployments
are out of scope and keep whatever Vercel does with them.

**`migrate.yml` loses its push trigger.** Leaving it would put a second, unordered migration
of the same push beside the one in the sequence. It keeps `workflow_dispatch` and
`workflow_call`, which is what the daily ingest and a person need. All three routes run the
same `npm run db:migrate` over the same `db/migrations`, applying only what the database has
not seen, so they cannot disagree about the schema whichever runs first.

**Only the tip of `main` deploys.** Running in the `production` GitHub Environment, whose
deployment branches are restricted to `main`, keeps the secrets away from any other ref, and
the job's `if:` and its single trigger say `main` twice more. None of the three stops a re-run
of an older run, which keeps its original commit, workflow file and ref: drizzle would apply
nothing and the deploy would ship old code behind the newer schema, which is a rollback nobody
chose. So the job fetches `origin/main` and fails, naming both SHAs, unless this commit is
still its tip — before any step holds a secret, and again just before the deploy.

**A run in progress is never cancelled.** `concurrency` keeps two merges from interleaving,
with `cancel-in-progress: false`, because a run cancelled between migrating and deploying
leaves the schema and the running code disagreeing with nothing left to reconcile them. A
queued run dropped in favour of a newer one is harmless: the newer commit contains the older.

**`VERCEL_TOKEN`'s value reaches the step that deploys and no other.** `npm ci` runs
dependencies' install scripts, and those have no business holding a deploy credential, so no
secret sits at job level. The preflight still has to fail loudly for a missing token, and it
does it without holding one: it is given `${{ secrets.VERCEL_TOKEN != '' }}`, which is the
boolean `true` or `false`. `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are identifiers rather than
credentials and may sit at job level; they are variables of the `production` environment, not
literals in this file, only because a public repository need not name an account's internals.
They have to be supplied rather than discovered: a project-scoped token cannot read the
account that owns it, so `vercel whoami` and `vercel link` both fail under one with
"User not found".

**A missing credential is a state, not a crash.** Every secret and identifier the job needs is
checked before the migration, and every missing one is named in the same run, with the command
that sets it. Until they are set, every merge fails at that step having changed nothing. That
is the workflow behaving as designed, not an outage.

**The Vercel CLI is not a dependency of this repository.** It is installed pinned to an exact
version into a directory outside the project, by a step that holds no secret. Not `npx
vercel@<version>` inside the deploy step, which pins only the top-level package and resolves
the rest at run time, running their install scripts beside the token. And not a devDependency,
which is what `rolodeck-ai` does: the CLI's tree carries a standing set of high and critical
advisories, and `npm audit --audit-level=high` is a required check here about what the app
ships. Putting the CLI in the lockfile would have meant either a permanently red audit or
turning the audit off, and a wall that cries wolf gets turned off.

## Rejected: Vercel's Deployment Checks

`migrate.yml` already pointed at them, and they would order the two correctly. They are a
setting in a dashboard. No file in this repository can turn them on, assert that they are on,
or notice when somebody turns them off, and the failure mode when they are off is exactly the
race this ADR exists to end. The same objection applies to the Git integration itself: the
reason production went stale for three and a half hours is that the thing doing the deploying
was somewhere nobody here could see.

## Rejected: deploying from a second job with `needs:`

A `needs:` between a migrate job and a deploy job orders them too. But each job checks out
again, installs again and, more to the point, the migrate job is the reusable workflow the
ingest calls, so its contract would be shared between two callers with different needs. Steps
in one job are the smaller thing, and "a failed step skips the rest" needs no explanation.

## Consequences

A deploy that fails after a successful migration leaves the schema ahead of the running code.
That is tolerable for an additive migration and not for a destructive one. A migration that
drops or renames something the running code reads must ship in two merges: the code stops
reading it, then the migration removes it. `db/migrations/` is in `.github/CODEOWNERS`, which
flags rather than gates, so the pull request saying so is what a reviewer has to go on.

Rollback stays manual. Promoting an earlier deployment in Vercel's dashboard rolls back the
code and not the schema, and the paragraph above is what makes that safe.

`.github/workflows/smoke.yml` keeps its hourly schedule but will stop being triggered by
`deployment_status`, because a CLI deploy reports no deployment status to GitHub. The deploy's
own last step runs the same check, so a deployment is still smoke checked the moment it is
made; the hourly run is what catches a production that breaks without a deploy. A deploy that
goes out broken therefore opens two issues, one from each workflow: the deploy's names the
merge that did it, the hourly one tracks whether production is still failing and closes itself
when it is not. Two is better than the nothing that started this.

`drizzle-kit migrate` exits non-zero when a migration fails, which is all the ordering needs.
Its progress display, however, swallows the Postgres error, so a failed migration step names
no cause in its log and the cause has to be found by running the migration against a copy.
