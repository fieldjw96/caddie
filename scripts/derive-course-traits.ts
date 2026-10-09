// `npm run derive:course-traits` derives Course Traits from every stored course and writes
// them to `course_traits`. The arithmetic lives in lib/course-traits.ts, pure and tested on
// its own; this script is only the database plumbing around it: read every course, derive,
// store, report.
//
// Idempotent: storeCourseTraits keys each row on (course_id, trait) and deletes any Trait this
// run did not produce for that course, so a course whose holes_trusted has since turned false
// does not keep stale hole-derived rows behind it.

import { client, db } from "../db/migration-client";
import { courses } from "../db/schema";
import { deriveCourseTraits } from "../lib/course-traits";
import { storeCourseTraits } from "../lib/course-traits-store";

function trustNote(course: { holesTrusted: boolean | null; holes: unknown }): string {
  if (course.holesTrusted === true) return "trusted holes";
  if (course.holesTrusted === false) return "holes not trusted, course-level Traits only";
  // A Course created from a Tournament's own Wikipedia article has no holes at all: that
  // article states a total, never a card. See lib/courses/from-tournament.ts.
  if (course.holes === null) return "no hole data, course-level Traits only";
  return "holes not checked, course-level Traits only";
}

async function main(): Promise<void> {
  try {
    const rows = await db.select().from(courses);
    let traitCount = 0;

    for (const course of rows) {
      const traits = deriveCourseTraits(course);
      await storeCourseTraits(db, course.id, traits);
      traitCount += traits.length;
      console.log(`ok    ${course.name}: ${traits.length} Traits (${trustNote(course)})`);
    }

    console.log(`${rows.length} courses, ${traitCount} Traits derived.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
