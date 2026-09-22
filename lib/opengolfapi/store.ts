// Writing an ingested course. Keyed on its OpenGolfAPI id, so storing the same course again
// updates its row rather than adding one.

import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { courses } from "../../db/schema";
import type { CourseRow } from "./ingest";

export async function storeCourse(
  db: PgDatabase<PgQueryResultHKT>,
  row: CourseRow,
): Promise<void> {
  await db
    .insert(courses)
    .values(row)
    .onConflictDoUpdate({
      target: courses.openGolfApiId,
      set: { ...row, recordedAt: sql`now()` },
    });
}
