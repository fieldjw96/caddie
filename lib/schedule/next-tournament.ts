// The one question the site exists to answer first: which Tournament is next. Pure, takes
// `now` as an argument, and reads no clock and no database of its own, so it is testable
// without either. See CONTEXT.md's Tournament.

/** The shape `nextTournament` needs: enough to pick one and to break a tie deterministically. */
export interface UpcomingTournament {
  name: string;
  startDate: string;
}

/**
 * The Tournament whose start date is soonest at or after `now`, or `null` once the season's
 * last Tournament has been played. `now` is compared by calendar day, in UTC: the day a
 * Tournament starts, it is still the next one, not the one after it.
 *
 * Two Tournaments starting the same day is a real possibility this schedule allows (an
 * "Additional event" run opposite a Signature event). When it happens, the one whose name
 * sorts first alphabetically wins, so the result never depends on the order rows arrived in.
 */
export function nextTournament<T extends UpcomingTournament>(
  tournaments: readonly T[],
  now: Date,
): T | null {
  const today = now.toISOString().slice(0, 10);
  const upcoming = tournaments.filter((t) => t.startDate >= today);
  if (upcoming.length === 0) return null;

  return upcoming.reduce((soonest, candidate) => {
    if (candidate.startDate !== soonest.startDate) {
      return candidate.startDate < soonest.startDate ? candidate : soonest;
    }
    return candidate.name < soonest.name ? candidate : soonest;
  });
}
