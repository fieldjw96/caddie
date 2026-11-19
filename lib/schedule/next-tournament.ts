// The one question the site exists to answer first: which Tournament is next. Pure, takes
// `now` as an argument, and reads no clock and no database of its own, so it is testable
// without either. See CONTEXT.md's Tournament.

/** The shape `nextTournament` needs: enough to pick one and to break a tie deterministically. */
export interface UpcomingTournament {
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * Every Tournament still to be played at `now`, soonest end date first. `now` is compared by
 * calendar day, in UTC: a Tournament stays upcoming from its first day through its final day,
 * not only until it starts.
 *
 * Two Tournaments ending the same day is a real possibility this schedule allows (an
 * "Additional event" run opposite a Signature event). When it happens, the one whose name
 * sorts first alphabetically comes first, so the order never depends on the order rows
 * arrived in.
 *
 * This is the one place the order is defined. `nextTournament` is its head, and lib/page's
 * walk down the schedule reads it in this order, so neither can drift from the other.
 */
export function upcomingTournaments<T extends UpcomingTournament>(
  tournaments: readonly T[],
  now: Date,
): T[] {
  const today = now.toISOString().slice(0, 10);
  return tournaments
    .filter((t) => t.endDate >= today)
    .sort((a, b) =>
      a.endDate === b.endDate ? compare(a.name, b.name) : compare(a.endDate, b.endDate),
    );
}

/** Plain code-unit order, the same comparison the reduce this replaced made with `<`. */
function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * The Tournament whose end date is soonest at or after `now`, or `null` once the season's
 * last Tournament has been played.
 */
export function nextTournament<T extends UpcomingTournament>(
  tournaments: readonly T[],
  now: Date,
): T | null {
  return upcomingTournaments(tournaments, now)[0] ?? null;
}
