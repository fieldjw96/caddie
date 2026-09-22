# Caddie

Which PGA Tour players suit the next tournament's course, and why.

Live at (deploy pending). Built entirely through Runs dispatched by
[foreman](https://github.com/fieldjw96/foreman), reviewed by a second agent, merged on green.

## The constraint that shapes it

Golf statistics are almost entirely off limits for a public site. pgatour.com's terms forbid
automated access and republication outright; ESPN's and CBS's are stricter still; DataGolf is
licensed for personal use only. Every free strokes gained dataset traces back to the PGA Tour,
so a permissive licence declared by an uploader does not cure it.

So this site holds only openly-licensed data, and computes its own measures rather than
republishing anyone else's. That is recorded in [ADR 0001](docs/adr/0001-only-openly-licensed-data.md)
and enforced in CI, not just written down.

## Reading it

- [CONTEXT.md](CONTEXT.md) is the vocabulary: Player, Course, Tournament, Course Trait, Fit Score.
- [CLAUDE.md](CLAUDE.md) is the rules an agent works under.
- [docs/adr/](docs/adr/) is why things are the way they are.

## Running it

    npm ci
    npm run dev

The schedule, from Wikipedia into `tournaments`: each Tournament's dates, its Course as its
own article names it, and its Location. About a request a second:

    npm run db:migrate
    npm run ingest:schedule

Course facts, from OpenGolfAPI into `courses`, for every Tournament of the current season that
names a Course, and each Tournament's `course_id` set to it. A match is by name within the
Tournament's state, and only when certain: exact, normalised (case, punctuation, accents and
words like "Golf Club" ignored), or declared by a person in `lib/courses/match.ts`. Anything
less is left null and listed at the end of the run with the name as the schedule wrote it.
Nothing is written until every request has been made, and a run that would need more than
OpenGolfAPI has left today stops, writes nothing and exits non-zero. Idempotent, and about 80
of the 500 requests a day:

    npm run ingest:courses

Altitude and green surface, from each Course's own Wikipedia article, added onto its
`courses` row. Neither is reliably published: a Course whose article cannot be found, or whose
infobox states neither field, is reported rather than treated as an error. Idempotent, and
about a request a second:

    npm run ingest:course-facts

Course Traits, derived from the courses just ingested into `course_traits`. Idempotent, and
refuses any Trait built on hole yardages for a course whose `holes_trusted` is false:

    npm run derive:course-traits

Results, from Wikipedia into `results`, for last season and this one: each played major's and
the Players' own leaderboard, the season's FedEx Cup Playoffs table, and the FedEx Cup
standings table once the season is over and it exists. A season in progress is read as far
as it has been played; events still to come are skipped and counted. Needs `ingest:players`
first: a name matching no player is reported, never created. Idempotent, and about twenty
requests at one a second. `-- 2025` reads one named season:

    npm run ingest:players
    npm run ingest:results

Player Strengths, derived from the stored results into `player_strengths`: Skill, Form and a
venue record at the next Tournament's Course from finishing positions, and Consistency and
Low rounds from the full-field leaderboards' round scores, each with the sample it rests on,
and null below five results. No network. Replaces every stored Strength, and reports how many Players
ended up with nothing at all. `-- 2025-09-01` derives as of a named day instead of today:

    npm run derive:strengths

The page, at `/`, reads all of the above from the database at request time: the next
Tournament, its Course Profile, the roster ordered by Fit Score, and what is not known.
With no upcoming Tournament stored it says so rather than showing an empty ranking.

## Production

The app and the ingest want _different_ connection strings, and neither has a default.

- **The app refuses to start without one.** `db/client.ts` resolves Supabase's pooled
  connection — `DATABASE_URL`, then `POSTGRES_URL` — and throws naming both if neither is set,
  so a deploy with no database is a 500 on every request, not an empty page. A serverless
  function opens and drops connections constantly and would exhaust a direct one.
- **The ingest writes to it from the repository secret `CADDIE_DATABASE_URL`**, and from
  nothing else. Set it with `gh secret set CADDIE_DATABASE_URL`, to the _direct_, non-pooling
  connection string: migrations and every ingest and derive script
  (`db/migration-client.ts`, `drizzle.config.ts`) need that one, since DDL and prepared
  statements do not survive a transaction-mode pooler. It reaches the scripts as
  `DATABASE_URL`, which `resolveMigrationDatabaseUrl()` accepts after `POSTGRES_URL_NON_POOLING`.
  It never goes in a file: this repository is public.

See `db/env.ts` and `.env.example` for every variable name each side resolves, in order.

[`.github/workflows/ingest.yml`](.github/workflows/ingest.yml) populates it, daily and by hand
from the Actions tab: migrations first, then every ingest above in dependency order, one step
per stage so a failure names its stage, then a count of what is stored, which fails the run if
any table is empty. Every line a stage prints is redacted before it is shown, and the run
fails if any log still shows a credential. The same stages run locally, one at a time:

    npm run ingest:stage -- courses

The site itself only reads. Nothing but that workflow and the migrations below write to
production.

## Is production working

The checks below read the source tree, and they can all pass while the deployed site returns
an error to every reader. On 2026-09-22 that is what happened. Three workflows address it:

- `.github/workflows/smoke.yml` asks production itself. It runs after every Production
  deployment, every hour and by hand. It requires HTTP 200, a Tournament named in the page's
  heading, at least one Player row and no Next.js error digest. A failure opens an issue
  titled "Production is failing its smoke check", or comments on the one already open, and
  the next pass closes it. It checks the address in `lib/production.ts`, the only file that
  holds that address, and takes no other address, so it cannot pass by checking a dev server
  or a preview deployment. To run it yourself:

      npm run smoke

- `.github/workflows/deploy.yml` is the only automated path to production, described below.
  Its last step is that same smoke check, so a deployment is checked the moment it is made
  and the run that made it goes red if the site it just put live is broken.

- `.github/workflows/migrate.yml` applies migrations to production by hand from the Actions
  tab, and as the daily ingest's first job. It does not run on a push: `deploy.yml` migrates
  as the step before it deploys, and a second trigger here would race it. It runs in the
  GitHub Environment `production`, and its credential is that environment's secret, not a
  repository secret. It needs a one-time setup:

      gh api -X PUT repos/fieldjw96/caddie/environments/production \
        -F 'deployment_branch_policy[protected_branches]=false' \
        -F 'deployment_branch_policy[custom_branch_policies]=true'
      gh api -X POST repos/fieldjw96/caddie/environments/production/deployment-branch-policies \
        -f name=main -f type=branch
      gh secret set POSTGRES_URL_NON_POOLING --env production

  The value must be the direct connection (Supabase's `POSTGRES_URL_NON_POOLING`), not the
  pooled one; the workflow refuses a value that looks pooled. GitHub compares environment
  names without regard to case, so this is the same `Production` environment Vercel reports
  its deployments to. Vercel only deploys `main` there, so limiting it to `main` takes nothing
  away from Vercel.

  The daily ingest runs this same workflow as its first job, and its later stages wait for
  it, so the ingest never writes to a schema older than `main`.

## Deploying

Merging to `main` migrates production and then deploys it, as steps of one job in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). A failed step skips every step
after it, so a failed migration means no deploy, and the deploy's own last step is the smoke
check above, so a deployment that serves a 500 fails the run that made it. Why it is a
workflow here rather than Vercel's Git integration is [ADR 0003](docs/adr/0003-deploying-is-one-ordered-sequence-run-from-actions.md).

**Vercel must not also deploy.** `vercel.json` sets `git.deploymentEnabled` to `false`, which
stops push builds, and **disconnecting the Git integration in the Vercel project's settings is
a human step this repository cannot do or verify**. Until somebody does it, Vercel may still
build a push and race the migration, which is the failure the workflow exists to end.

It reads one secret and two identifiers, all of them on the `production` GitHub Environment
rather than the repository, so only a job that names that environment, on `main`, can have
them. None of them goes in a file: this repository is public.

| Name                       | What                                                                    | Where it comes from                                                                                    |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POSTGRES_URL_NON_POOLING` | Secret. The direct connection the migration applies DDL over.           | Supabase, as above. Already set for `migrate.yml`; the deploy reads the same one.                      |
| `VERCEL_TOKEN`             | Secret. Lets the CLI deploy. Scope it to this project, not the account. | <https://vercel.com/account/tokens>                                                                    |
| `VERCEL_ORG_ID`            | Variable, not a secret. Which account owns the project.                 | `orgId` in `.vercel/project.json` after running `vercel link` locally, or the project's settings page. |
| `VERCEL_PROJECT_ID`        | Variable, not a secret. Which project to deploy.                        | `projectId` in the same file.                                                                          |

The identifiers have to be given rather than discovered: a project-scoped token cannot read
the account that owns it, so `vercel whoami` and `vercel link` both fail under one with "User
not found". Setting all four:

    gh secret set VERCEL_TOKEN --env production
    gh variable set VERCEL_ORG_ID --env production --body team_xxxxxxxx
    gh variable set VERCEL_PROJECT_ID --env production --body prj_xxxxxxxx
    gh secret set POSTGRES_URL_NON_POOLING --env production

Until they are all set, every merge fails at the workflow's preflight step, which names each
missing one and the command above that sets it, having migrated nothing and deployed nothing.

To redeploy, re-run the Deploy run for the current tip of `main`. The job refuses to deploy a
commit `main` has moved past — it checks before it touches a secret and again before it
deploys — because a re-run of an older run would ship old code behind the newer schema.

## Checks

What CI runs:

    npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
