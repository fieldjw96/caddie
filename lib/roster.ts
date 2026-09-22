/**
 * The roster the page ranks, absent a confirmed Field. ADR 0002: no open source publishes
 * tournament entry lists, so the page ranks the regular tour roster instead of an actual
 * field, and says so rather than implying otherwise.
 *
 * The rule, for now: every ingested Player is in the roster. Wikidata's PGA Tour player
 * identifier (see scripts/queries/players.rq) already limits `players` to tour players, and
 * this Ticket's data holds no signal - no recent Result, no activity flag - that would let this
 * function separate an active player from a retired one. Ranking everyone is the honest default
 * until such a signal exists; narrowing it silently would not be.
 */
export function selectRoster<T>(players: readonly T[]): T[] {
  return [...players];
}
