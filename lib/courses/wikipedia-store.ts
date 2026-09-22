// Writing one Course's Wikipedia facts back onto its row. Nothing here fetches anything, so
// it is tested against a real, migrated Postgres in wikipedia-store.db.test.ts alone.

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { courses } from "../../db/schema";
import type { CourseFactsOutcome } from "./wikipedia-ingest";

// Generic over schema: called with db/migration-client.ts's schema-attached db from
// scripts/ingest-course-facts.ts, and with a schema-less one from wikipedia-store.db.test.ts.
// Cares only that it can run a query, not which connection or whether it carries a schema.
type Database<TSchema extends Record<string, unknown>> = PgDatabase<PgQueryResultHKT, TSchema>;

/**
 * A fact this run did not find is stored null, with its source_url null alongside it, exactly
 * as absence is stored everywhere else in this schema. A Course whose article could not be
 * read this run (`no-article`) is left as it was: a fetch failure says nothing about whether
 * a fact stored by an earlier run still holds, so nothing here overwrites it with null.
 */
export async function storeCourseFacts<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  outcome: CourseFactsOutcome,
): Promise<void> {
  if (outcome.status !== "read") return;
  await db
    .update(courses)
    .set({
      altitude: outcome.altitudeFeet,
      altitudeSource: outcome.altitudeFeet === null ? null : "wikipedia",
      altitudeSourceUrl: outcome.altitudeFeet === null ? null : outcome.sourceUrl,
      greenSurface: outcome.greenSurface,
      greenSurfaceSource: outcome.greenSurface === null ? null : "wikipedia",
      greenSurfaceSourceUrl: outcome.greenSurface === null ? null : outcome.sourceUrl,
    })
    .where(eq(courses.id, outcome.courseId));
}
