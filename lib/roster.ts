/**
 * The roster the page ranks, absent a confirmed Field. ADR 0002: no open source publishes
 * tournament entry lists, so the page ranks the regular tour roster instead of an actual
 * field, and says so rather than implying otherwise.
 *
 * The rule: every Player with a stored Result - either basis, leaderboard or standings - at a
 * Tournament whose last day falls within ROSTER_WINDOW_MONTHS months of the as-of date. Every
 * ingested Player carries a PGA Tour identifier (scripts/queries/players.rq), living or dead,
 * active or retired, which is why `players` alone is not a roster: it holds nobody's activity.
 * A stored Result is the one signal this data does hold that a Player is still playing, so
 * recency of the last one is what defines the roster.
 *
 * This is a selection over `players`, not a filter applied to it: nothing is deleted, and a
 * Player who returns to form reappears the moment a new Result is ingested for them, with no
 * re-ingest of `players` needed.
 */
export const ROSTER_WINDOW_MONTHS = 12;

/** The day `months` months before `date`, both `YYYY-MM-DD`, in UTC. */
function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`"${date}" is not a YYYY-MM-DD date`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** As much of a stored Result as the roster rule needs. */
export interface RosterResult {
  playerId: number;
  /** The Tournament's last day, `YYYY-MM-DD`. */
  endDate: string;
}

/**
 * The cutoff date, inclusive: a Result on this day or later keeps a Player on the roster.
 * Exported so the page can state the rule in the same words it is applied by.
 */
export function rosterCutoff(asOf: string): string {
  return monthsBefore(asOf, ROSTER_WINDOW_MONTHS);
}

/**
 * `players`, narrowed to those with a Result at or after `rosterCutoff(asOf)`. Order follows
 * `players`; a Player is included at most once regardless of how many qualifying Results they
 * have.
 */
export function selectRoster<T extends { id: number }>(
  players: readonly T[],
  results: readonly RosterResult[],
  asOf: string,
): T[] {
  const cutoff = rosterCutoff(asOf);
  const active = new Set(results.filter((r) => r.endDate >= cutoff).map((r) => r.playerId));
  return players.filter((p) => active.has(p.id));
}
