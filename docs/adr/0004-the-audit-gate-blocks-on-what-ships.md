---
status: accepted
---

# The audit gate blocks on what ships, and only reports on the toolchain

`npm audit --audit-level=high` was one step in the CI wall, ahead of typecheck, lint and the
tests, so a known-vulnerable dependency stopped a merge the way a failing test does. It stays
exactly that for anything a visitor's request touches. For the dev-only tree it becomes a
warning: a second, `continue-on-error` step audits the whole tree and marks the job yellow.

## Why it changed

CI had been red since 2026-09-23, and nobody noticed because nothing was trying to merge. When
Ticket #50 did, it could not: the audit step runs first, so its failure skips typecheck, lint,
format, the tests and the build, and the job reports nothing at all about the change under
review. The Run that wrote #50 diagnosed this correctly and declined to fix it in that pull
request, which was the right call and is why this is its own ADR.

What was actually in the tree, on 2026-10-08:

| Package                       | Severity     | Ships? | Fixable                                |
| ----------------------------- | ------------ | ------ | -------------------------------------- |
| `next` 16.0.0–16.3.7          | **critical** | yes    | yes, 16.3.8                            |
| `sharp` <0.35.5               | high         | yes    | yes, `npm audit fix`                   |
| `source-map-js`               | high         | no     | yes, `npm audit fix`                   |
| `braces`                      | high         | no     | **no fix exists**                      |
| `esbuild` (via `drizzle-kit`) | high         | no     | only by going back to drizzle-kit 0.18 |

The first three are patched, and the critical one mattered most: this is a public site and the
advisory is a remote code execution in `next/og`. Nothing was gained by leaving it while the
wall was red for other reasons.

The last two cannot be patched. `braces@3.0.3` is the newest published release and the advisory
covers every version, so there is nothing to point an override at, and `npm audit`'s only
remedy is `eslint-config-next@14.2.35` — two majors back, to match a Next 14 lint config against
a Next 16 application. `esbuild`'s is `drizzle-kit@0.18.1`, from 0.31. Both are absurd, and both
are a denial of service in a build-time tool.

`npm audit --omit=dev --audit-level=high` reports no vulnerabilities at all once the three
patchable ones are done.

## Considered Options

**Wait for a patch.** The repository stays frozen for an unbounded period decided by somebody
else's release schedule, and because this repo merges unattended that freeze stops every Run too.

**Take the downgrades `npm audit fix --force` offers.** Rejected: `eslint-config-next` two majors
back and `drizzle-kit` from 0.31 to 0.18, to remove a lint-time glob matcher and a dev-server
bundler. The cure is far worse than the disease.

**Override the unfixable ones to a patched release.** Not possible for either: there is no
patched release. Worth recording, because it is the first thing the next person will reach for.

**Lower the threshold to `critical`.** Fewer stoppages, and it would have waved through a high
in `sharp` that does ship. The threshold is not what was wrong.

**A list of ignored advisory ids.** `npm audit` has no per-advisory exclusion, so this means a
wrapper script holding ids somebody must prune. Nobody prunes it. A rule about what ships needs
no maintenance.

## Consequences

**The thing that actually mattered still blocks a merge.** `next`, `react`, `drizzle-orm`,
`postgres`, `recharts` and `zod` are production dependencies; an advisory in any of them fails
the gate exactly as before. The `next/og` critical would have.

**What this gives up is real.** A compromised build tool runs on CI runners and on the laptops,
and an advisory there no longer blocks a merge. It is still reported on every run rather than
discovered later, and the honest reason this is acceptable rather than comfortable is that the
alternative was a repository that could not merge anything.

**A yellow job is now something to read.** If the reporting step starts failing for a reason
that is not a glob matcher — a postinstall script, a compiler, a test runner — that is worth
acting on and nothing will force the issue. This ADR accepts that weakness knowingly.

**rolodeck-ai made the same decision three days earlier**, for the same `braces` advisory, as
its own ADR 0022. The two repositories reached it independently and the reasoning is the same;
neither depends on the other, and this file is not a copy so much as the same answer to the same
question. If one is revisited, revisit both.
