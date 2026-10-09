// The Course of last resort: one created from the Tournament's own Wikipedia article, for every
// Tournament OpenGolfAPI does not have the course for.
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
// Every Tournament, not just the next one, because a venue record is a Player's results at
// *this* Course and only joins where a past Tournament points at the same `courses` row. A
// Tournament linked to nothing takes its whole leaderboard out of reach of that column.
//
// Which makes one thing load-bearing: two Tournaments at one venue must reach one row. So a
// venue is resolved against what is already stored — and against what this run's OpenGolfAPI
// matches are about to store — by lib/courses/match.ts's own normalisation, the same reading
// that decides an OpenGolfAPI match. A second row for a venue already held would split the
// history and leave the column confidently wrong about how often somebody has played there,
// which is worse than leaving it empty.
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
import { distinctiveWords, implausibleRecord, normaliseName, scheduledCourses } from "./match";

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
 * A `courses` row a Tournament's article venue can be pointed at instead of a new one: one
 * already stored, or one this run's OpenGolfAPI matches are about to store.
 *
 * `courseId` is null for the second kind, which has no id until it is written;
 * `openGolfApiId` is how lib/opengolfapi/store.ts finds it once it has.
 */
export interface KnownCourse {
  /** `courses.id`, or null for a row this run has not written yet. */
  courseId: number | null;
  /** Its OpenGolfAPI id, when it came from there. Null for an article-sourced Course. */
  openGolfApiId: string | null;
  name: string;
}

/** One Tournament pointed at a venue, named so a report can say which. */
export interface TournamentRef {
  id: number;
  name: string;
}

/**
 * One venue, the `courses` row it is, and every Tournament played on it. Either a Course to
 * store, this run being the first to know of it, or one already accounted for to point at —
 * never both, and never neither, which is why this is a union rather than two nullable fields.
 */
export type ArticleVenue = {
  /** The venue as the article of the first of these Tournaments names it. */
  name: string;
  tournaments: TournamentRef[];
} & ({ reuse: null; row: CourseRow } | { reuse: KnownCourse; row: null });

/** A Tournament whose article supports no Course, and the reason, in words a person can check. */
export interface TournamentCourseSkip {
  tournamentId: number;
  tournamentName: string;
  reason: string;
}

export interface ArticleCoursePlan {
  venues: ArticleVenue[];
  skipped: TournamentCourseSkip[];
}

/**
 * What makes two names one venue: lib/courses/match.ts's own reading, the words that identify
 * a course once case, accents, punctuation and words like "Golf Club" are set aside. This is
 * the `normalised` tier of an OpenGolfAPI match, called rather than restated, so "The Riviera
 * Country Club" and "Riviera Country Club" cannot end up as two rows.
 *
 * It is that rule and no more: an abbreviation is a distinctive word, so "Riviera CC" reads as
 * a venue of its own and would be stored as one. Widening the rule here would be a second
 * implementation of it, and the two would drift; widening `GENERIC_WORDS` in match.ts widens
 * what an OpenGolfAPI match will accept too, which is a judgement of its own.
 *
 * A name of nothing but generic words — "The Golf Club" — has no distinctive words at all, and
 * falls back to the whole normalised name rather than keying every such venue alike.
 */
export function venueKey(name: string): string {
  const distinctive = distinctiveWords(name).join(" ");
  return distinctive === "" ? normaliseName(name) : distinctive;
}

/** The Tournament whose article states a venue's facts: the most recent to be played there. */
function mostRecentFirst(a: TournamentCourseRow, b: TournamentCourseRow): number {
  return b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name);
}

const described = (c: KnownCourse) =>
  `"${c.name}"${c.openGolfApiId === null ? "" : ` (OpenGolfAPI ${c.openGolfApiId})`}`;

/**
 * Every Tournament OpenGolfAPI could not match, resolved to the Course its own article names.
 *
 * `matchedTournamentIds` keeps OpenGolfAPI preferred: a Tournament matched there is not
 * considered here at all, so nothing can overwrite a match to a record with a card in it.
 *
 * `known` is every Course this run can point at — the `courses` table as it stands, plus the
 * rows the OpenGolfAPI matches are about to write. A venue that reads as exactly one of them
 * is pointed at it rather than stored again, whichever Source that row came from. A venue that
 * reads as two of them is skipped and reported: those two rows may well be one venue, but
 * merging them is a migration with a judgement in it and a Ticket of its own, and guessing
 * which of the two the Tournament was played on would be the confidently-wrong link this
 * whole path exists to avoid.
 *
 * Tournaments are resolved most recent first, so where several articles name one venue it is
 * the newest reading of its par and yardage that becomes the row, and the rest point at it.
 */
export function planArticleCourses(
  tournaments: readonly TournamentCourseRow[],
  matchedTournamentIds: ReadonlySet<number>,
  known: readonly KnownCourse[],
): ArticleCoursePlan {
  const knownByVenue = new Map<string, KnownCourse[]>();
  for (const course of known) {
    const key = venueKey(course.name);
    knownByVenue.set(key, [...(knownByVenue.get(key) ?? []), course]);
  }

  const venues = new Map<string, ArticleVenue>();
  const skipped: TournamentCourseSkip[] = [];

  for (const tournament of [...tournaments].sort(mostRecentFirst)) {
    if (matchedTournamentIds.has(tournament.id)) continue;
    const outcome = planTournamentArticleCourse(tournament);
    if (outcome.status === "skipped") {
      skipped.push({
        tournamentId: outcome.tournamentId,
        tournamentName: outcome.tournamentName,
        reason: outcome.reason,
      });
      continue;
    }
    const ref = { id: tournament.id, name: tournament.name };
    const key = venueKey(outcome.row.name);
    const already = venues.get(key);
    if (already) {
      already.tournaments.push(ref);
      continue;
    }
    const stored = knownByVenue.get(key) ?? [];
    if (stored.length > 1) {
      skipped.push({
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        reason:
          `its article names "${outcome.row.name}", which reads as ${stored.length} stored ` +
          `Courses (${stored.map(described).join("; ")}), and which of them it is played on ` +
          "cannot be told from here",
      });
      continue;
    }
    const [only] = stored;
    venues.set(key, {
      name: outcome.row.name,
      tournaments: [ref],
      ...(only ? { reuse: only, row: null } : { reuse: null, row: outcome.row }),
    });
  }

  return { venues: [...venues.values()], skipped };
}
