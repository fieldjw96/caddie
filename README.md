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

Course facts, from OpenGolfAPI into the `courses` table at `DATABASE_URL`. Idempotent, and
about 16 of the 500 requests a day OpenGolfAPI allows:

    npm run db:migrate
    npm run ingest:courses

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
venue record at the next Tournament's Course, each with the sample it rests on, and null
below five results. No network. Replaces every stored Strength, and reports how many Players
ended up with nothing at all. `-- 2025-09-01` derives as of a named day instead of today:

    npm run derive:strengths

The page, at `/`, reads all of the above from `DATABASE_URL` at request time: the next
Tournament, its Course Profile, the roster ordered by Fit Score, and what is not known.
With no upcoming Tournament stored it says so rather than showing an empty ranking.

Checks, which are what CI runs:

    npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
