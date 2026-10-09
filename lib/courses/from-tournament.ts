// The Course of last resort: one created from the Tournament's own Wikipedia article, for the
// next Tournament only, when OpenGolfAPI does not have the course at all.
//
// This is a fallback, not an alternative. OpenGolfAPI is the preferred Source for a Course and
// nothing here runs until a search there has failed: it holds a card, tees, Slope and Rating
// and the holes, where an article holds a name, a par and a total. But OpenGolfAPI's only hit
// for Yokohama Country Club is a driving range, which lib/courses/match.ts rightly refused,
// and the Tour's autumn swing is the international one — Japan, Bermuda, Mexico — so a Course
// OpenGolfAPI has never heard of is a weekly event rather than a one-off. With no Course there
// are no Course Traits, with no Traits no Fit Score, and the page renders no rows at all.
//
// Two facts are enough to fix that: `length_yards` and `par` are both course-level Traits in
// lib/course-traits.ts, and either one gives every Player with a Strength a Fit Score. The
// facts come from the one fetch `ingest:schedule` already makes of that article, stored on
// `tournaments` (see db/schema.ts), so this costs no request of its own.
//
// What it must never do is fill a gap in. `holes`, `holesTrusted` and everything derived from
// them stay absent: an article states a total, never a card, and a hole-by-hole yardage
// invented from a total is exactly the confidently-wrong data `holes_trusted` exists to catch.
// Slope and Rating are absent for the same reason. An article missing any of the three fields
// is reported and skipped, because a Course with a guessed par is worse than no Course.
//
// Pure: no fetch, no database. lib/opengolfapi/store.ts writes the outcome, in the same
// transaction as the matches, so a run leaves one consistent set of links or none.

import type { CourseRow } from "../opengolfapi/ingest";
import { nextTournament } from "../schedule/next-tournament";
import { implausibleRecord, scheduledCourses } from "./match";

/** The stored `tournaments` columns this reads: the Course facts, and where they were read. */
export interface TournamentCourseRow {
  id: number;
  name: string;
  startDate: string;
  courseName: string | null;
  coursePar: number | null;
  courseYardage: number | null;
  courseArticleUrl: string | null;
}

/**
 * What became of one Tournament's article as a Source for its Course. A skip carries the
 * reason in words a person can check against the article itself, because that is how the next
 * blank week gets diagnosed; `Austin Championship: "(no Course named)"` is a real row in the
 * log and stays a clean skip rather than a failure.
 */
export type TournamentCourseOutcome =
  | { status: "created"; tournamentId: number; tournamentName: string; row: CourseRow }
  | { status: "skipped"; tournamentId: number; tournamentName: string; reason: string };

/** The attribution CC BY-SA requires, ready for the page to print as it is. */
export function wikipediaAttribution(tournamentName: string): string {
  return `Course facts from the English Wikipedia article on the ${tournamentName}, CC BY-SA 4.0`;
}

function skipped(tournament: TournamentCourseRow, reason: string): TournamentCourseOutcome {
  return {
    status: "skipped",
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    reason,
  };
}

/**
 * The `courses` row a Tournament's article supports, or the reason it supports none.
 *
 * The Course's name is read through `scheduledCourses`, the same reading the OpenGolfAPI match
 * uses, so a qualifier is kept ("TPC Sawgrass Stadium Course") and a template is unwrapped. An
 * article naming several courses is skipped: the par and the yardage belong to one of them and
 * nothing here can say which.
 */
export function planTournamentArticleCourse(
  tournament: TournamentCourseRow,
): TournamentCourseOutcome {
  if (tournament.courseName === null)
    return skipped(tournament, "its article names no Course");
  const listed = scheduledCourses(tournament.courseName);
  const [only] = listed;
  if (!only) return skipped(tournament, "its article's Course field is empty");
  if (listed.length > 1) {
    return skipped(
      tournament,
      `its article names ${listed.length} courses (${listed.map((c) => c.name).join("; ")}), ` +
        "and the par and yardage beside them belong to one",
    );
  }
  if (tournament.coursePar === null) {
    return skipped(tournament, "its article states no par that reads as a number");
  }
  if (tournament.courseYardage === null) {
    return skipped(
      tournament,
      "its article states no yardage that reads as a number of yards",
    );
  }
  // Null only for a row written before this column existed, which the database now refuses
  // alongside a par or a yardage. Checked anyway: a fact with nowhere it came from is not one
  // this repo stores, let alone displays.
  if (tournament.courseArticleUrl === null) {
    return skipped(tournament, "its article's revision was not recorded with those facts");
  }
  const implausible = implausibleRecord(tournament.coursePar, tournament.courseYardage);
  if (implausible) {
    return skipped(
      tournament,
      `its article states par ${tournament.coursePar} and ${tournament.courseYardage} yards, but ${implausible}`,
    );
  }

  return {
    status: "created",
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    row: {
      name: only.name,
      openGolfApiId: null,
      par: tournament.coursePar,
      publishedYardage: tournament.courseYardage,
      architect: null,
      tees: null,
      // Absent, not zero, and not the course-level total standing in for a card.
      holes: null,
      holesCheckedTee: null,
      holesYardageSum: null,
      holesYardageDifference: null,
      holesTrusted: null,
      attribution: wikipediaAttribution(tournament.name),
      source: "wikipedia",
      sourceUrl: tournament.courseArticleUrl,
      derivation: null,
    },
  };
}

/**
 * The fallback for the next Tournament, or null when there is nothing to fall back from.
 *
 * Null means OpenGolfAPI is doing its job: the next Tournament matched a course there, so that
 * course is used and this path is not taken at all. Null also covers a season with no
 * Tournament still to play. Only the next Tournament is considered — it is the only one the
 * page renders, so it is the only one whose missing Course blanks the page — and which one
 * that is comes from the same `nextTournament` the page itself uses, never a second rule.
 */
export function planNextTournamentCourse<T extends TournamentCourseRow>(
  tournaments: readonly T[],
  matchedTournamentIds: ReadonlySet<number>,
  now: Date,
): TournamentCourseOutcome | null {
  const next = nextTournament(tournaments, now);
  if (next === null || matchedTournamentIds.has(next.id)) return null;
  return planTournamentArticleCourse(next);
}
