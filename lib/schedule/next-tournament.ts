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
 * The Tournament whose end date is soonest at or after `now`, or `null` once the season's
 * last Tournament has been played. `now` is compared by calendar day, in UTC: a Tournament
 * stays the next one from its first day through its final day, not only until it starts.
 *
 * Two Tournaments ending the same day is a real possibility this schedule allows (an
 * "Additional event" run opposite a Signature event). When it happens, the one whose name
 * sorts first alphabetically wins, so the result never depends on the order rows arrived in.
 */
export function nextTournament<T extends UpcomingTournament>(
  tournaments: readonly T[],
  now: Date,
): T | null {
  const today = now.toISOString().slice(0, 10);
  const upcoming = tournaments.filter((t) => t.endDate >= today);
  if (upcoming.length === 0) return null;

  return upcoming.reduce((soonest, candidate) => {
    if (candidate.endDate !== soonest.endDate) {
      return candidate.endDate < soonest.endDate ? candidate : soonest;
    }
    return candidate.name < soonest.name ? candidate : soonest;
  });
}
