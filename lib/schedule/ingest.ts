// Turns parsed schedule rows into `tournaments` rows and writes them. Split from
// scripts/ingest-schedule.ts so the transform (`buildTournamentRecords`) is testable without a
// network and the write (`upsertTournaments`) is testable without one either — only
// `resolveCourseFacts` touches Wikipedia.

import { sql } from "drizzle-orm";
import type { db as dbClient } from "../../db/client";
import { tournaments } from "../../db/schema";
import { extractTournamentCourse, type TournamentCourseFacts } from "./course-name";
import type { ScheduleRow } from "./parse";
import { fetchArticle, revisionUrl } from "./wikipedia";

type Database = typeof dbClient;

/**
 * What one Tournament's own article gave up: the venue facts its infobox states, and the
 * revision they were read at. An article that could not be read has no entry at all rather
 * than an entry of nulls, because "it states no par" and "nobody could read it this week" are
 * different facts and the upsert treats them differently.
 */
export interface TournamentArticleCourse extends TournamentCourseFacts {
  articleUrl: string;
}

/** One row this Ticket writes: `source` is always Wikipedia, never a guess at `courses`. */
export interface TournamentRecord {
  name: string;
  season: number;
  startDate: string;
  endDate: string;
  courseName: string | null;
  coursePar: number | null;
  courseYardage: number | null;
  /** The Tournament's own article at the revision the three fields above were read at. */
  courseArticleUrl: string | null;
  location: string | null;
  source: "wikipedia";
  sourceUrl: string;
}

/**
 * Parsed rows, each Tournament article's venue facts, and the revision the season's schedule
 * was read at, turned into the rows this Ticket writes. Canceled tournaments are dropped here,
 * after being counted by the caller: a tournament that did not happen is not one to rank a
 * Course fit for.
 *
 * A Tournament whose article could not be read gets nulls and no revision URL, which is how
 * `upsertTournaments` knows to leave whatever an earlier run stored alone.
 */
export function buildTournamentRecords(
  rows: readonly ScheduleRow[],
  season: number,
  sourceUrl: string,
  courseFacts: ReadonlyMap<string, TournamentArticleCourse>,
): TournamentRecord[] {
  return rows
    .filter((row) => !row.canceled)
    .map((row) => {
      const facts = courseFacts.get(row.pageTitle) ?? null;
      return {
        name: row.name,
        season,
        startDate: row.startDate,
        endDate: row.endDate,
        courseName: facts?.name ?? null,
        coursePar: facts?.par ?? null,
        courseYardage: facts?.yardage ?? null,
        courseArticleUrl: facts?.articleUrl ?? null,
        location: row.location,
        source: "wikipedia" as const,
        sourceUrl,
      };
    });
}

/**
 * Each tournament's own Wikipedia article, best-effort: an article that can't be read is left
 * out of the map rather than stopping the run. This Ticket's Zod boundary is the schedule
 * table's shape; a missing Course name is a gap the site can show, not a reason to fail the
 * whole ingest. Throttled the same as every other call to the API, module-wide.
 *
 * One request per Tournament, exactly as before, and every venue fact comes out of it: the
 * Course's name, its par and its yardage are three fields of one infobox, so lib/courses's
 * fallback for a Course OpenGolfAPI does not have needs no fetch of its own.
 */
export async function resolveCourseFacts(
  pageTitles: readonly string[],
): Promise<Map<string, TournamentArticleCourse>> {
  const facts = new Map<string, TournamentArticleCourse>();
  for (const title of pageTitles) {
    try {
      const article = await fetchArticle(title);
      facts.set(title, {
        ...extractTournamentCourse(article.wikitext),
        articleUrl: revisionUrl(article.title, article.revid),
      });
    } catch {
      // Left out deliberately: see TournamentArticleCourse.
    }
  }
  return facts;
}

/**
 * Upserts on the `(name, season)` unique index the schema already enforces: running this
 * twice with the same records updates the existing rows instead of duplicating them, which is
 * what makes the ingest idempotent.
 *
 * The three venue facts are written as one unit, and only when this run actually read the
 * article — which is exactly when it has a revision URL to attribute them to. A fetch that
 * failed leaves the stored facts as they were, because a request that did not arrive says
 * nothing about whether what an earlier run read still holds. An article that was read and
 * states nothing does clear them, because that is a fact about the article.
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
        courseName: sql`case when excluded.course_article_url is null
          then ${tournaments.courseName} else excluded.course_name end`,
        coursePar: sql`case when excluded.course_article_url is null
          then ${tournaments.coursePar} else excluded.course_par end`,
        courseYardage: sql`case when excluded.course_article_url is null
          then ${tournaments.courseYardage} else excluded.course_yardage end`,
        courseArticleUrl: sql`case when excluded.course_article_url is null
          then ${tournaments.courseArticleUrl} else excluded.course_article_url end`,
        location: sql`excluded.location`,
        sourceUrl: sql`excluded.source_url`,
        recordedAt: sql`now()`,
      },
    });
}
