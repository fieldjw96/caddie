// Writing derived Course Traits for one course. Keyed on (course_id, trait), so deriving the
// same course again updates its rows rather than adding to them. Also deletes any Trait this
// run did not produce for the course: a Trait a Ticket refuses to derive must actually be
// absent from `course_traits`, not left behind from an earlier run where, say, holes_trusted
// was still true.

import { and, eq, notInArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { courseTraits } from "../db/schema";
import type { DerivedCourseTrait } from "./course-traits";

// Generic over schema: called with db/migration-client.ts's schema-attached db from
// scripts/derive-course-traits.ts, and with a schema-less one from
// course-traits-store.db.test.ts. Cares only that it can run a query, not which connection or
// whether it carries a schema.
export async function storeCourseTraits<TSchema extends Record<string, unknown>>(
  db: PgDatabase<PgQueryResultHKT, TSchema>,
  courseId: number,
  traits: DerivedCourseTrait[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const names = traits.map((t) => t.trait);
    await tx
      .delete(courseTraits)
      .where(
        names.length > 0
          ? and(eq(courseTraits.courseId, courseId), notInArray(courseTraits.trait, names))
          : eq(courseTraits.courseId, courseId),
      );

    if (traits.length === 0) return;

    await tx
      .insert(courseTraits)
      .values(traits.map((t) => ({ ...t, courseId })))
      .onConflictDoUpdate({
        target: [courseTraits.courseId, courseTraits.trait],
        set: {
          value: sql`excluded.value`,
          unit: sql`excluded.unit`,
          source: sql`excluded.source`,
          sourceUrl: sql`excluded.source_url`,
          derivation: sql`excluded.derivation`,
          recordedAt: sql`now()`,
        },
      });
  });
}
