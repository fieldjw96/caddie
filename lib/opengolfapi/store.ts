// Writing ingested courses, and every stored season's matches. Courses are keyed on their
// OpenGolfAPI id, so storing the same course again updates its row rather than adding one, and
// a Tournament's match is set outright each run, so re-running changes no counts.
//
// A Course created from a Tournament's own Wikipedia article, because OpenGolfAPI does not have
// it, is written here too — in the same transaction as the matches, so a run leaves one
// consistent set of links or none at all. It has no OpenGolfAPI id to be keyed on, so it is
// keyed on its name instead, through the partial unique index db/schema.ts declares for exactly
// that. Which venue is which was already settled, by name, in lib/courses/from-tournament.ts:
// nothing here decides it a second time, and a venue that plan says is a Course already stored
// is linked to without a write of any kind.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { courses, tournaments } from "../../db/schema";
import type { ArticleCoursePlan, KnownCourse } from "../courses/from-tournament";
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
 * `fromArticles` is written after the matches and wins for its own Tournaments alone: a venue
 * is only ever planned for a Tournament OpenGolfAPI did not match, so the two cannot disagree.
 * Each venue is written once, however many Tournaments are played on it, which is what puts
 * their results within reach of one another's venue record.
 *
 * Where an article could not be read as a Course — one that states no par, or one nothing has
 * read yet — a Course an earlier run created from that same article is left linked rather than
 * cleared, because this run's failure says nothing about whether that Course is still the right
 * one. Nothing else is spared: a Tournament whose OpenGolfAPI match this run could not repeat
 * is still cleared, as it was before.
 */
export async function storePlan<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  plan: CoursePlan,
  fromArticles: ArticleCoursePlan = { venues: [], skipped: [] },
): Promise<void> {
  await db.transaction(async (tx) => {
    const idByOpenGolfApiId = new Map<string, number>();
    for (const row of plan.rows) {
      idByOpenGolfApiId.set(row.openGolfApiId!, await storeCourse(tx, row));
    }
    const spared = new Set(fromArticles.skipped.map((s) => s.tournamentId));
    for (const { tournament, resolution } of plan.outcomes) {
      const matched = resolution.status === "matched" ? resolution : null;
      // Left as it is only if what is there came from this same article; a stale OpenGolfAPI
      // match is cleared like any other. A Tournament with no match at all matches neither
      // arm and needs no clearing.
      if (matched === null && spared.has(tournament.id)) {
        await tx
          .update(tournaments)
          .set({ courseId: null, courseMatch: null })
          .where(
            and(
              eq(tournaments.id, tournament.id),
              inArray(tournaments.courseMatch, ["exact", "normalised", "declared"]),
            ),
          );
        continue;
      }
      await tx
        .update(tournaments)
        .set({
          courseId: matched ? idByOpenGolfApiId.get(matched.openGolfApiId)! : null,
          courseMatch: matched?.confidence ?? null,
        })
        .where(eq(tournaments.id, tournament.id));
    }

    /** A venue's `courses.id`: the row just written, or the one it was found to already be. */
    const idOf = (reuse: KnownCourse): number => {
      if (reuse.courseId !== null) return reuse.courseId;
      const written = idByOpenGolfApiId.get(reuse.openGolfApiId!);
      if (written === undefined) {
        throw new Error(
          `Planned to reuse "${reuse.name}" (OpenGolfAPI ${reuse.openGolfApiId}), which this ` +
            "run did not store. Nothing was written.",
        );
      }
      return written;
    };
    for (const venue of fromArticles.venues) {
      const courseId = venue.reuse
        ? idOf(venue.reuse)
        : await storeCourseByName(tx, venue.row);
      await tx
        .update(tournaments)
        .set({ courseId, courseMatch: "tournament_article" })
        .where(
          inArray(
            tournaments.id,
            venue.tournaments.map((t) => t.id),
          ),
        );
    }
  });
}
