// The database reads behind `checkRankable`'s decision: every Tournament so the next one can
// be found, every Course so a Tournament's venue can be matched the same way
// lib/page/data.ts's `matchCourse` matches it, how many Course Traits each matched Course has,
// and whether any Player anywhere has a Strength. scripts/ingest-rankable.ts and
// app/api/health/route.ts both need to ask the same question of the same database, and a
// second copy of these queries is a second place they could drift apart.
//
// Hands back rows rather than a verdict: lib/ingest/rankable.ts and
// lib/page/choose-tournament.ts are the pure decisions built on top, and stay testable without
// a database. This file is the one place that is not.

import { count, isNotNull } from "drizzle-orm";
import type { db as appDb } from "../../db/client";
import { courses, courseTraits, playerStrengths, tournaments } from "../../db/schema";

type Database = typeof appDb;

/** One stored Tournament: everything `nextTournament`/`upcomingTournaments` and `matchCourse` need. */
export interface ScheduleRow {
  name: string;
  startDate: string;
  endDate: string;
  /** The Course name as the schedule's own Source recorded it, matched or not. */
  courseName: string | null;
  courseId: number | null;
  sourceUrl: string | null;
}

export interface RankabilityData {
  schedule: ScheduleRow[];
  courses: { id: number; name: string }[];
  /** Stored Course Traits, grouped by `courses.id`. A Course absent here has none. */
  traitCounts: ReadonlyMap<number, number>;
  /** Whether any Player anywhere has a non-null Strength of any kind. */
  anyPlayerHasStrength: boolean;
}

/** Everything `checkRankable` and `chooseRankableTournament` need, read in one round trip. */
export async function gatherRankabilityData(db: Database): Promise<RankabilityData> {
  const [schedule, courseRows, traitCountRows, strengthRows] = await Promise.all([
    db
      .select({
        name: tournaments.name,
        startDate: tournaments.startDate,
        endDate: tournaments.endDate,
        courseName: tournaments.courseName,
        courseId: tournaments.courseId,
        sourceUrl: tournaments.sourceUrl,
      })
      .from(tournaments),
    db.select({ id: courses.id, name: courses.name }).from(courses),
    db
      .select({ courseId: courseTraits.courseId, traits: count() })
      .from(courseTraits)
      .groupBy(courseTraits.courseId),
    db.select({ n: count() }).from(playerStrengths).where(isNotNull(playerStrengths.value)),
  ]);
  return {
    schedule,
    courses: courseRows,
    traitCounts: new Map(traitCountRows.map((r) => [r.courseId, r.traits])),
    anyPlayerHasStrength: (strengthRows[0]?.n ?? 0) > 0,
  };
}
