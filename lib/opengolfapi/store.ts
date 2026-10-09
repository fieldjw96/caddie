// Writing an ingested course, and a season's matches. Courses are keyed on their OpenGolfAPI
// id, so storing the same course again updates its row rather than adding one, and a
// Tournament's match is set outright each run, so re-running changes no counts.
//
// A Course created from the next Tournament's own Wikipedia article, because OpenGolfAPI does
// not have it, is written here too — in the same transaction as the matches, so a run leaves
// one consistent set of links or none at all. It has no OpenGolfAPI id to be keyed on, so it
// is keyed on its name instead, through the partial unique index db/schema.ts declares for
// exactly that. See lib/courses/from-tournament.ts for when it is reached.

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { courses, tournaments } from "../../db/schema";
import type { TournamentCourseOutcome } from "../courses/from-tournament";
import type { CoursePlan, CourseRow } from "./ingest";

// Generic over schema: called with db/migration-client.ts's schema-attached db from
// scripts/ingest-courses.ts, and with a schema-less one from store.db.test.ts. Cares only that
// it can run a query, not which connection or whether it carries a schema.
type Database<TSchema extends Record<string, unknown>> = PgDatabase<PgQueryResultHKT, TSchema>;

/** Upserts one course and returns its `courses.id`. */
export async function storeCourse<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  row: CourseRow,
): Promise<number> {
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
 * Upserts a Course that has no OpenGolfAPI id, on its name, and returns its `courses.id`. The
 * index is partial — `where opengolfapi_id is null` — so this can never update a course
 * OpenGolfAPI provided, whatever it is called.
 */
export async function storeCourseByName<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  row: CourseRow,
): Promise<number> {
  const [stored] = await db
    .insert(courses)
    .values(row)
    .onConflictDoUpdate({
      target: courses.name,
      targetWhere: isNull(courses.openGolfApiId),
      set: { ...row, recordedAt: sql`now()` },
    })
    .returning({ id: courses.id });
  return stored!.id;
}

/**
 * Writes a whole plan in one transaction: every matched course, then every Tournament in it,
 * each set to its match or to null. A Tournament that matched last time and does not now is
 * cleared rather than left pointing at a match this run could not repeat.
 *
 * `fromArticle`, when the next Tournament needed it, is written after the matches and wins for
 * that Tournament alone: it is only ever produced for a Tournament OpenGolfAPI did not match,
 * so the two cannot disagree. When it was needed and could not be built — an article that
 * states no par, or one nothing has read yet — a Course an earlier run created from that same
 * article is left linked rather than cleared, because this run's failure says nothing about
 * whether that Course is still the right one. Nothing else is spared: a Tournament whose
 * OpenGolfAPI match this run could not repeat is still cleared, as it was before.
 */
export async function storePlan<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  plan: CoursePlan,
  fromArticle: TournamentCourseOutcome | null = null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const idByOpenGolfApiId = new Map<string, number>();
    for (const row of plan.rows) {
      idByOpenGolfApiId.set(row.openGolfApiId!, await storeCourse(tx, row));
    }
    const spared = fromArticle?.status === "skipped" ? fromArticle.tournamentId : null;
    for (const { tournament, resolution } of plan.outcomes) {
      const matched = resolution.status === "matched" ? resolution : null;
      await tx
        .update(tournaments)
        .set({
          courseId: matched ? idByOpenGolfApiId.get(matched.openGolfApiId)! : null,
          courseMatch: matched?.confidence ?? null,
        })
        .where(
          tournament.id === spared
            ? // Left as it is only if what is there came from this same article; a stale
              // OpenGolfAPI match is cleared like any other. A Tournament with no match at
              // all matches neither arm and needs no clearing.
              and(
                eq(tournaments.id, tournament.id),
                ne(tournaments.courseMatch, "tournament_article"),
              )
            : eq(tournaments.id, tournament.id),
        );
    }
    if (fromArticle?.status === "created") {
      const courseId = await storeCourseByName(tx, fromArticle.row);
      await tx
        .update(tournaments)
        .set({ courseId, courseMatch: "tournament_article" })
        .where(eq(tournaments.id, fromArticle.tournamentId));
    }
  });
}
