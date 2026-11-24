// Writing ingested courses, and every stored season's matches. Courses are keyed on their
// OpenGolfAPI id, so storing the same course again updates its row rather than adding one, and
// a Tournament's match is only ever set to a match this run made, so re-running changes no
// counts and a run that matched nothing changes nothing.
//
// A Course created from a Tournament's own Wikipedia article, because OpenGolfAPI does not have
// it, is written here too — in the same transaction as the matches, so a run leaves one
// consistent set of links or none at all. It has no OpenGolfAPI id to be keyed on, so it is
// keyed on its name instead, through the partial unique index db/schema.ts declares for exactly
// that. Which venue is which was already settled, by name, in lib/courses/from-tournament.ts:
// nothing here decides it a second time, and a venue that plan says is a Course already stored
// is linked to without a write of any kind.

import { eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { courses, tournaments, type CourseMatch } from "../../db/schema";
import type { ArticleCoursePlan, KnownCourse } from "../courses/from-tournament";
import type { CoursePlan, CourseRow, Resolution } from "./ingest";

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
 * One Tournament whose stored link this run left exactly as it found it, because it had nothing
 * better to say about the venue. The caller reports these: a link nobody re-confirmed is still
 * the best answer there is, but it is worth saying out loud which Tournaments are living on one.
 */
export interface KeptLink {
  tournamentId: number;
  tournamentName: string;
  /** The `courses.id` still linked, and the name under which a reader will see it. */
  courseId: number;
  courseName: string;
  /** How that link was matched, as it stands stored, which is not how this run resolved it. */
  courseMatch: CourseMatch;
  /** This run's resolution, which could not re-confirm the link. Never `matched`. */
  status: Exclude<Resolution["status"], "matched">;
}

/**
 * Writes a whole plan in one transaction: every matched course, then a link for every
 * Tournament this run matched.
 *
 * A stored link is only ever replaced by something better: a match this run made, or the
 * Course a Tournament's own article names. A resolution of anything else — `near-miss`,
 * `failed` — leaves `course_id` and `course_match` exactly as they are, whatever they are,
 * `declared` included, because a search that came back differently today says nothing about
 * whether yesterday's link was right. Clearing one of those blanked a whole Tournament week
 * once (#158), taking the Course, its Traits and every Fit Score with it. Where a venue really
 * has changed, `upsertTournaments` in lib/schedule/ingest.ts clears the link as it writes the
 * new `course_name`: that is the one place that can tell, because it is the only one that sees
 * the name a link was made against.
 *
 * Every link written here sets both columns together, so `tournaments_course_match_is_recorded`
 * holds on every path.
 *
 * The Tournaments whose link was left unconfirmed are returned, for the caller to report.
 *
 * `fromArticles` is written after the matches and wins for its own Tournaments alone: a venue
 * is only ever planned for a Tournament OpenGolfAPI did not match, so the two cannot disagree.
 * Each venue is written once, however many Tournaments are played on it, which is what puts
 * their results within reach of one another's venue record.
 *
 * Where an article could not be read as a Course — one that states no par, or one nothing has
 * read yet — nothing special happens: `fromArticles.skipped` plans no venue, so the rule above
 * leaves whatever is linked alone. That is why the branch this function used to keep for those
 * Tournaments is gone, rather than kept and widened.
 */
export async function storePlan<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  plan: CoursePlan,
  fromArticles: ArticleCoursePlan = { venues: [], skipped: [] },
): Promise<KeptLink[]> {
  return db.transaction(async (tx) => {
    const idByOpenGolfApiId = new Map<string, number>();
    for (const row of plan.rows) {
      idByOpenGolfApiId.set(row.openGolfApiId!, await storeCourse(tx, row));
    }
    // Linked from their own articles further down, so their links are not kept ones: this run
    // has something to say about the venue, just not from OpenGolfAPI.
    const relinked = new Set(
      fromArticles.venues.flatMap((venue) => venue.tournaments.map((t) => t.id)),
    );
    const kept: KeptLink[] = [];
    for (const { tournament, resolution } of plan.outcomes) {
      if (resolution.status !== "matched") {
        if (relinked.has(tournament.id)) continue;
        // The inner join is the question being asked: a Tournament with nothing linked has no
        // link to keep, and drops out rather than being reported as one.
        const [stored] = await tx
          .select({
            courseId: courses.id,
            courseName: courses.name,
            courseMatch: tournaments.courseMatch,
          })
          .from(tournaments)
          .innerJoin(courses, eq(tournaments.courseId, courses.id))
          .where(eq(tournaments.id, tournament.id));
        // `course_match` is non-null wherever `course_id` is, by check constraint; this reads
        // it back rather than asserting it, because the report prints it.
        if (stored && stored.courseMatch !== null) {
          kept.push({
            tournamentId: tournament.id,
            tournamentName: tournament.name,
            courseId: stored.courseId,
            courseName: stored.courseName,
            courseMatch: stored.courseMatch,
            status: resolution.status,
          });
        }
        continue;
      }
      await tx
        .update(tournaments)
        .set({
          courseId: idByOpenGolfApiId.get(resolution.openGolfApiId)!,
          courseMatch: resolution.confidence,
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
    return kept;
  });
}
