// Writing one Course's Wikipedia facts back onto its row. Nothing here fetches anything, so
// it is tested against a real, migrated Postgres in wikipedia-store.db.test.ts alone.

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { courses } from "../../db/schema";
import type { CourseFactsOutcome } from "./wikipedia-ingest";

type Database = PgDatabase<PgQueryResultHKT>;

/**
 * A fact this run did not find is stored null, with its source_url null alongside it, exactly
 * as absence is stored everywhere else in this schema. A Course whose article could not be
 * read this run (`no-article`) is left as it was: a fetch failure says nothing about whether
 * a fact stored by an earlier run still holds, so nothing here overwrites it with null.
 */
export async function storeCourseFacts(db: Database, outcome: CourseFactsOutcome): Promise<void> {
  if (outcome.status !== "read") return;
  await db
    .update(courses)
    .set({
      altitude: outcome.altitudeFeet,
      altitudeSourceUrl: outcome.altitudeFeet === null ? null : outcome.sourceUrl,
      greenSurface: outcome.greenSurface,
      greenSurfaceSourceUrl: outcome.greenSurface === null ? null : outcome.sourceUrl,
    })
    .where(eq(courses.id, outcome.courseId));
}
