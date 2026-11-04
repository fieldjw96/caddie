// `npm run ingest:course-altitude` reads the altitude of every Course that has coordinates and no
// altitude yet off the Copernicus elevation model. Needs `ingest:course-facts` and
// `ingest:course-cards` first: the first may supply an altitude, which is preferred, and the
// second may supply the coordinates. See lib/courses/elevation.ts.
//
// A Course with an altitude is not asked about again, so after the first run this costs one
// request on the days a new Course appears and none otherwise. A failed read is reported, and
// not an error: the Course keeps showing that its altitude is unknown and the next run asks again.

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { client, db } from "../db/migration-client";
import { courses } from "../db/schema";
import { readCourseAltitudes, type CourseToLocate } from "../lib/courses/elevation";

async function main(): Promise<void> {
  try {
    const rows = await db
      .select({
        id: courses.id,
        name: courses.name,
        latitude: courses.latitude,
        longitude: courses.longitude,
      })
      .from(courses)
      .where(and(isNull(courses.altitude), isNotNull(courses.latitude)));
    console.log(`Reading the elevation model for ${rows.length} Courses.`);

    const outcomes = await readCourseAltitudes(rows as CourseToLocate[]);
    let read = 0;
    for (const outcome of outcomes) {
      if (outcome.status === "unread") {
        console.log(`  miss  ${outcome.name}: ${outcome.reason}`);
        continue;
      }
      await db
        .update(courses)
        .set({
          altitude: outcome.altitudeFeet,
          altitudeSource: "copernicus",
          altitudeSourceUrl: outcome.sourceUrl,
        })
        .where(eq(courses.id, outcome.courseId));
      read += 1;
      console.log(`  ok    ${outcome.name}: ${outcome.altitudeFeet} ft`);
    }
    console.log(`\n${read} of ${rows.length} Courses got an altitude.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
