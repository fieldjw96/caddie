// `npm run ingest:course-facts` reads altitude and green surface off every stored Course's own
// Wikipedia article and writes whichever of the two its infobox carries. Needs `ingest:courses`
// first: this enriches the Courses OpenGolfAPI has already matched, rather than fetching a
// Wikipedia article for a Course that is not on the schedule at all.
//
// The article looked up is the Wikipedia-native facility name lib/courses/wikipedia-name.ts
// derives from the schedule's own Course name (joined in from `tournaments`, which is where
// `ingest:schedule` already read it from each Tournament's own article), never OpenGolfAPI's
// reconstructed one — see that Ticket for why the two differ enough to matter. A Course a
// Tournament names in more than one season keeps whichever schedule name was recorded first;
// they should not disagree.
//
// One or two requests per Course — one more only when the exact title misses and a search
// fallback finds a confident match — at the module-wide one-a-second throttle every Wikipedia
// caller shares (lib/schedule/wikipedia.ts). A Course whose article cannot be found
// confidently, or whose infobox states neither field, is expected and reported, not an error:
// these are prose-adjacent articles and most will come back with at least one fact missing.
// Idempotent: storing the same reading twice writes the same row, and a fetch failure never
// overwrites an earlier success.

import { eq } from "drizzle-orm";
import { client, db } from "../db/migration-client";
import { courses, tournaments } from "../db/schema";
import { fetchCourseFacts, type CourseToRead } from "../lib/courses/wikipedia-ingest";
import { wikipediaFacilityName } from "../lib/courses/wikipedia-name";
import { storeCourseFacts } from "../lib/courses/wikipedia-store";

type MigrationDb = typeof db;

/**
 * Every stored Course, with the Wikipedia-native facility name resolved from whichever of its
 * Tournaments named a Course first. `courses` outlives any one Tournament, and more than one
 * can be matched to it across seasons; the first recorded is as good a choice as any, since a
 * Course's own name does not change under it.
 */
async function coursesToRead(db: MigrationDb): Promise<CourseToRead[]> {
  const rows = await db
    .select({
      id: courses.id,
      name: courses.name,
      scheduleCourseName: tournaments.courseName,
    })
    .from(courses)
    .leftJoin(tournaments, eq(tournaments.courseId, courses.id))
    .orderBy(courses.id, tournaments.recordedAt);

  const byId = new Map<number, CourseToRead>();
  for (const row of rows) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      wikipediaName:
        row.scheduleCourseName === null ? null : wikipediaFacilityName(row.scheduleCourseName),
    });
  }
  return [...byId.values()];
}

async function main(): Promise<void> {
  try {
    const stored = await coursesToRead(db);
    console.log(`Reading Wikipedia for ${stored.length} Courses.`);

    const outcomes = await fetchCourseFacts(stored);
    for (const outcome of outcomes) {
      await storeCourseFacts(db, outcome);
      if (outcome.status === "read") {
        const altitude =
          outcome.altitudeFeet === null ? "no altitude" : `${outcome.altitudeFeet} ft`;
        const greens =
          outcome.greenSurface === null ? "no green surface" : outcome.greenSurface;
        console.log(`  ok    ${outcome.name}: ${altitude}, ${greens}`);
      } else {
        console.log(`  miss  ${outcome.name}: ${outcome.reason}`);
      }
    }

    const read = outcomes.filter((o) => o.status === "read");
    const withAltitude = read.filter((o) => o.altitudeFeet !== null).length;
    const withGreenSurface = read.filter((o) => o.greenSurface !== null).length;
    console.log(
      `\n${withAltitude} of ${stored.length} Courses got an altitude, ` +
        `${withGreenSurface} of ${stored.length} got a green surface.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
