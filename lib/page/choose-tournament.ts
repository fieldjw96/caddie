// Which upcoming Tournament the page is actually about. Three different root causes have left
// the homepage with zero Player rows — a Course below the Length scale's floor, a Course with
// no published card, a Tournament with no Wikipedia article — and each needed a person to
// notice. So rather than take the soonest Tournament whatever state it is in, this walks the
// schedule in `upcomingTournaments`' order and stops at the first one `checkRankable` passes,
// recording every Tournament it stepped over and why.
//
// Pure, and the rankability rule is not restated here: `checkRankable` is imported and asked.
// The database reads the counts it needs — see lib/page/load.ts, which reads the Courses once
// and every Course's Trait count in one grouped query, so walking further costs no more
// queries than stopping at the first candidate.

import { checkRankable } from "../ingest/rankable";
import { matchCourse, type SkippedTournamentView } from "./data";

/** What the walk needs of one upcoming Tournament, in the order the schedule gives them. */
export interface TournamentCandidate {
  name: string;
  /** The Course name as the schedule's own Source recorded it, matched or not. */
  courseName: string | null;
  courseId: number | null;
  sourceUrl: string | null;
}

export interface ChosenTournament<T> {
  /**
   * The soonest Tournament that passes, or — when none in the rest of the season does — the
   * true next one, so the page shows that Tournament's own unavailable state rather than a
   * blank page or whichever candidate the walk happened to examine last. `null` only for an
   * empty schedule.
   */
  tournament: T | null;
  /**
   * The Tournaments stepped over to reach `tournament`, in schedule order. Empty whenever
   * `tournament` is the true next one, including when nothing was rankable: the page is then
   * about the Tournament it was always about, and nothing was substituted to disclose.
   */
  skipped: SkippedTournamentView[];
  /**
   * How many candidates were tested. Not shown to a reader: it is how the global
   * short-circuit below is observable, since "did not walk the schedule" and "walked it and
   * failed everything" otherwise return the same answer.
   */
  examined: number;
}

/**
 * Walks `upcoming` in order and returns the first rankable Tournament with the ones it
 * skipped. `courses` is every stored `courses` row, read once by the caller, and `traitCounts`
 * maps a `courses.id` to how many Course Traits are stored for it; a Course absent from the
 * map has none.
 *
 * `anyPlayerHasStrength` is a fact about the whole database, not about any one Tournament:
 * when it is false no Tournament anywhere can be ranked, so the walk stops at the first
 * candidate instead of stepping over the entire remaining season to reach the same answer.
 */
export function chooseRankableTournament<
  T extends TournamentCandidate,
  C extends { id: number; name: string },
>(
  upcoming: readonly T[],
  courses: readonly C[],
  traitCounts: ReadonlyMap<number, number>,
  anyPlayerHasStrength: boolean,
): ChosenTournament<T> {
  const skipped: SkippedTournamentView[] = [];
  let examined = 0;

  for (const candidate of upcoming) {
    examined += 1;
    const courseId = matchCourse(candidate, courses)?.id ?? null;
    const result = checkRankable({
      next: { name: candidate.name, courseName: candidate.courseName, courseId },
      courseTraitCount: courseId === null ? 0 : (traitCounts.get(courseId) ?? 0),
      anyPlayerHasStrength,
    });
    if (result.ok) return { tournament: candidate, skipped, examined };
    // No Strength anywhere dooms every candidate equally, so there is nothing further to
    // learn from the rest of the schedule.
    if (!anyPlayerHasStrength) break;
    skipped.push({
      name: candidate.name,
      reason: result.reason,
      sourceUrl: candidate.sourceUrl,
    });
  }

  return { tournament: upcoming[0] ?? null, skipped: [], examined };
}
