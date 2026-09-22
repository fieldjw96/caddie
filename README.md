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

The page, at `/`, reads all of the above from `DATABASE_URL` at request time: the next
Tournament, its Course Profile, the roster ordered by Fit Score, and what is not known.
With no upcoming Tournament stored it says so rather than showing an empty ranking.

Checks, which are what CI runs:

    npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
