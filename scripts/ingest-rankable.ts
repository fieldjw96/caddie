// `npm run ingest:rankable`. The verdict on everything else the ingest did: whether the next
// Tournament, the one the page is about to render, can actually be ranked. Runs after
// `ingest:report`, reads only what the earlier stages already stored, and fails loudly, naming
// which of lib/ingest/rankable.ts's three conditions is true, rather than letting a green run
// hide a page with zero Player rows. See that file for the decision; lib/ingest/rankable-query.ts
// is the gathering, shared with app/api/health/route.ts; this just shapes it into the next
// Tournament and asks.

import { client, db } from "../db/migration-client";
import { checkRankable, type NextTournament } from "../lib/ingest/rankable";
import { gatherRankabilityData } from "../lib/ingest/rankable-query";
import { matchCourse } from "../lib/page/data";
import { nextTournament } from "../lib/schedule/next-tournament";

async function main(): Promise<void> {
  const { schedule, courses, traitCounts, anyPlayerHasStrength } =
    await gatherRankabilityData(db);
  const upcoming = nextTournament(schedule, new Date());
  const matchedCourse = upcoming
    ? matchCourse({ courseId: upcoming.courseId, courseName: upcoming.courseName }, courses)
    : null;
  const next: NextTournament | null = upcoming
    ? {
        name: upcoming.name,
        courseName: upcoming.courseName,
        courseId: matchedCourse?.id ?? null,
      }
    : null;

  const result = checkRankable({
    next,
    courseTraitCount: next?.courseId == null ? 0 : (traitCounts.get(next.courseId) ?? 0),
    anyPlayerHasStrength,
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
