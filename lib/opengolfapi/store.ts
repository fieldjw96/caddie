// Writing an ingested course, and a season's matches. Courses are keyed on their OpenGolfAPI
// id, so storing the same course again updates its row rather than adding one, and a
// Tournament's match is set outright each run, so re-running changes no counts.

import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { courses, tournaments } from "../../db/schema";
import type { CoursePlan, CourseRow } from "./ingest";

type Database = PgDatabase<PgQueryResultHKT>;

/** Upserts one course and returns its `courses.id`. */
export async function storeCourse(db: Database, row: CourseRow): Promise<number> {
  const [stored] = await db
    .insert(courses)
    .values(row)
    .onConflictDoUpdate({
      target: courses.openGolfApiId,
      set: { ...row, recordedAt: sql`now()` },
    })
    .returning({ id: courses.id });
  return stored!.id;
}

/**
 * Writes a whole plan in one transaction: every matched course, then every Tournament in it,
 * each set to its match or to null. A Tournament that matched last time and does not now is
 * cleared rather than left pointing at a match this run could not repeat.
 */
export async function storePlan(db: Database, plan: CoursePlan): Promise<void> {
  await db.transaction(async (tx) => {
    const idByOpenGolfApiId = new Map<string, number>();
    for (const row of plan.rows) {
      idByOpenGolfApiId.set(row.openGolfApiId!, await storeCourse(tx, row));
    }
    for (const { tournament, resolution } of plan.outcomes) {
      const matched = resolution.status === "matched" ? resolution : null;
      await tx
        .update(tournaments)
        .set({
          courseId: matched ? idByOpenGolfApiId.get(matched.openGolfApiId)! : null,
          courseMatch: matched?.confidence ?? null,
        })
        .where(eq(tournaments.id, tournament.id));
    }
  });
}
