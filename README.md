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

Results, from Wikipedia into `results`, for the most recent season with final FedEx Cup
standings. Needs `ingest:players` first: a name matching no player is reported, never
created. Idempotent, and about ten requests at one a second:

    npm run ingest:players
    npm run ingest:results

Checks, which are what CI runs:

    npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
