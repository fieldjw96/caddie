// `npm run ingest:rankable`. The verdict on everything else the ingest did: whether the next
// Tournament, the one the page is about to render, can actually be ranked. Runs after
// `ingest:report`, reads only what the earlier stages already stored, and fails loudly, naming
// which of lib/ingest/rankable.ts's three conditions is true, rather than letting a green run
// hide a page with zero Player rows. See that file for the decision; this just gathers what it
// needs to make it.

import { count, eq, isNotNull } from "drizzle-orm";
import { client, db } from "../db/migration-client";
import { courseTraits, playerStrengths, tournaments } from "../db/schema";
import { checkRankable, type NextTournament } from "../lib/ingest/rankable";
import { nextTournament } from "../lib/schedule/next-tournament";

async function courseTraitCount(courseId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(courseTraits)
    .where(eq(courseTraits.courseId, courseId));
  return row?.n ?? 0;
}

async function anyPlayerHasStrength(): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(playerStrengths)
    .where(isNotNull(playerStrengths.value));
  return (row?.n ?? 0) > 0;
}

async function main(): Promise<void> {
  const schedule = await db
    .select({
      name: tournaments.name,
      startDate: tournaments.startDate,
      courseName: tournaments.courseName,
      courseId: tournaments.courseId,
    })
    .from(tournaments);
  const upcoming = nextTournament(schedule, new Date());
  const next: NextTournament | null = upcoming
    ? { name: upcoming.name, courseName: upcoming.courseName, courseId: upcoming.courseId }
    : null;

  const result = checkRankable({
    next,
    courseTraitCount: next?.courseId == null ? 0 : await courseTraitCount(next.courseId),
    anyPlayerHasStrength: await anyPlayerHasStrength(),
  });

  if (result.ok) {
    console.log(
      next === null
        ? "No next Tournament is scheduled, so there is nothing to rank."
        : `Next Tournament: ${next.name}. Its Course has a Course Trait and the roster has a Strength, so it can be ranked.`,
    );
  } else {
    console.error(result.reason);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
