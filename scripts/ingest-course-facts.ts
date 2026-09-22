// `npm run ingest:course-facts` reads altitude and green surface off every stored Course's own
// Wikipedia article and writes whichever of the two its infobox carries. Needs `ingest:courses`
// first: this enriches the Courses OpenGolfAPI has already matched, rather than fetching a
// Wikipedia article for a Course that is not on the schedule at all.
//
// One request per Course, at the module-wide one-a-second throttle every Wikipedia caller
// shares (lib/schedule/wikipedia.ts). A Course whose article cannot be found, or whose infobox
// states neither field, is expected and reported, not an error: these are prose-adjacent
// articles and most will come back with at least one fact missing. Idempotent: storing the
// same reading twice writes the same row, and a fetch failure never overwrites an earlier
// success.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { courses } from "../db/schema";
import { fetchCourseFacts } from "../lib/courses/wikipedia-ingest";
import { storeCourseFacts } from "../lib/courses/wikipedia-store";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

async function main(): Promise<void> {
  const client = postgres(url!, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  try {
    const stored = await db.select({ id: courses.id, name: courses.name }).from(courses);
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
