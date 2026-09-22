# Caddie

A public site that ranks the field of the next PGA Tour tournament by how well each Player's
game suits that Course, with the weightings on display and adjustable.

Built entirely through Runs dispatched by `foreman`. See [[CONTEXT]] for this repo's
vocabulary and `docs/adr/` for its decisions.

## Scope, and what this is not

**This site is public and has no accounts.** No login, no auth, no per-user state on the
server. Do not add any. A reader opens a link and sees the answer.

**It is not a tipping or betting product.** A Fit Score is an opinion with its arithmetic on
display. Never present it as a prediction of who will win, never attach odds to it, and never
phrase a heading as advice.

**It is a showcase.** The first paint matters more than the feature count. A page that loads
instantly with a clear answer beats a page with three more charts.

## Stack

TypeScript everywhere, `strict` plus `noUncheckedIndexedAccess`. Next.js App Router on Vercel.
Postgres through Drizzle. Recharts for every chart. Zod at every external boundary. Vitest.

## Rules

**Only openly-licensed data, and this is the rule that shapes everything.** Wikidata, Wikipedia
and OpenGolfAPI are in. pgatour.com, ESPN and CBS are prohibited by their own terms and must
never be fetched, not even once, not even in a test fixture. DataGolf is licensed for personal
use only and may not be republished. See ADR 0001. Adding a Source needs an ADR amending it.

**Every stored fact carries its Source.** A fact whose Source is unknown is not displayed. A
Player Strength is always `Derived`, computed here, never copied from someone else's published
rating.

**External data is hostile.** Every external field is parsed through a Zod schema at the
boundary. A site that changes shape fails loudly, at the edge, naming the field, rather than
letting `undefined` reach a page.

**Attribution is a feature, not a footnote.** ODbL and CC BY-SA both require it. The page that
shows the data shows where it came from.

## Definition of done

A pull request merges itself once every required check is green and the review Gate has
approved it, and the branch is up to date with `main`. Those rules are enforced by a GitHub
branch ruleset rather than by the supervisor.

`.github/workflows/` and `db/migrations/` are listed in `.github/CODEOWNERS`. As in
`rolodeck-ai`, that listing flags rather than gates: it cannot gate, because the ruleset's only
bypass actor is the admin role the Runs act as. A pull request touching those paths should say
so plainly in its body, because nothing else will.

**This repo is public.** Nothing secret goes in it, in any commit, ever. There is no
`.env` with a real value in it and no API key in a workflow that is not a repository secret.
