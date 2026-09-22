// Turns parsed schedule rows into `tournaments` rows and writes them. Split from
// scripts/ingest-schedule.ts so the transform (`buildTournamentRecords`) is testable without a
// network and the write (`upsertTournaments`) is testable without one either — only
// `resolveCourseNames` touches Wikipedia.

import { sql } from "drizzle-orm";
import type { db as dbClient } from "../../db/client";
import { tournaments } from "../../db/schema";
import { extractCourseName } from "./course-name";
import type { ScheduleRow } from "./parse";
import { fetchArticle } from "./wikipedia";

type Database = typeof dbClient;

/** One row this Ticket writes: `source` is always Wikipedia, never a guess at `courses`. */
export interface TournamentRecord {
  name: string;
  season: number;
  startDate: string;
  endDate: string;
  courseName: string | null;
  source: "wikipedia";
  sourceUrl: string;
}

/**
 * Parsed rows, a resolved Course name per tournament article, and the revision they were read
 * at, turned into the rows this Ticket writes. Canceled tournaments are dropped here, after
 * being counted by the caller: a tournament that did not happen is not one to rank a Course
 * fit for.
 */
export function buildTournamentRecords(
  rows: readonly ScheduleRow[],
  season: number,
  sourceUrl: string,
  courseNames: ReadonlyMap<string, string | null>,
): TournamentRecord[] {
  return rows
    .filter((row) => !row.canceled)
    .map((row) => ({
      name: row.name,
      season,
      startDate: row.startDate,
      endDate: row.endDate,
      courseName: courseNames.get(row.pageTitle) ?? null,
      source: "wikipedia" as const,
      sourceUrl,
    }));
}

/**
 * Each tournament's own Wikipedia article, best-effort: an article that can't be read, or has
 * no `course` field, gets `null` rather than stopping the run. This Ticket's Zod boundary is
 * the schedule table's shape; a missing Course name is a gap the site can show, not a reason
 * to fail the whole ingest. Throttled the same as every other call to the API, module-wide.
 */
export async function resolveCourseNames(
  pageTitles: readonly string[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  for (const title of pageTitles) {
    try {
      const article = await fetchArticle(title);
      names.set(title, extractCourseName(article.wikitext));
    } catch {
      names.set(title, null);
    }
  }
  return names;
}

/**
 * Upserts on the `(name, season)` unique index the schema already enforces: running this
 * twice with the same records updates the existing rows instead of duplicating them, which is
 * what makes the ingest idempotent.
 */
export async function upsertTournaments(
  database: Database,
  records: readonly TournamentRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await database
    .insert(tournaments)
    .values([...records])
    .onConflictDoUpdate({
      target: [tournaments.name, tournaments.season],
      set: {
        startDate: sql`excluded.start_date`,
        endDate: sql`excluded.end_date`,
        courseName: sql`excluded.course_name`,
        sourceUrl: sql`excluded.source_url`,
        recordedAt: sql`now()`,
      },
    });
}
