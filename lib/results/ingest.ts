// Turns parsed events into `results` rows and writes them. The transform
// (`buildResultRecords`) is pure and testable without a network or a database; the writes
// (`ensureTournaments`, `upsertResults`) are testable without a network.
//
// Players are matched, never created. This repo's players come from Wikidata, and a name in
// a results table that matches nobody is a signal to report, not a gap to fill in.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { db as dbClient } from "../../db/client";
import { results, tournaments, type ResultBasis } from "../../db/schema";
import type { ScheduleRow } from "../schedule/parse";
import type { PlayerIndex } from "./names";
import type { EventResults } from "./types";

type Database = typeof dbClient;

/** One row this Ticket writes. `source` is always Wikipedia: every field is read, not made. */
export interface ResultRecord {
  playerId: number;
  tournamentId: number;
  position: number | null;
  basis: ResultBasis;
  finish: string;
  round1: number | null;
  round2: number | null;
  round3: number | null;
  round4: number | null;
  source: "wikipedia";
  sourceUrl: string;
}

/** An event read from a table, with the revision it was read at. */
export interface SourcedEvent extends EventResults {
  sourceUrl: string;
}

export interface BuiltResults {
  records: ResultRecord[];
  /** Every name that matched no `players` row, with how many lines it appeared on. */
  unmatched: Map<string, number>;
  /** Every name that matched more than one `players` row, and so was matched to none. */
  ambiguous: Map<string, number>;
  /** Events read that the season's schedule has no Tournament for. */
  unscheduled: string[];
}

/**
 * The records to write, one per Player per Tournament. A full-field leaderboard is the better
 * reading of an event than the standings table, so where both give a Player's finish in one
 * event the leaderboard's is the one kept, whatever order the events arrive in.
 */
export function buildResultRecords(
  events: readonly SourcedEvent[],
  tournamentIds: ReadonlyMap<string, number>,
  players: PlayerIndex,
): BuiltResults {
  const unmatched = new Map<string, number>();
  const ambiguous = new Map<string, number>();
  const unscheduled: string[] = [];
  const byKey = new Map<string, ResultRecord>();
  const tally = (counts: Map<string, number>, name: string) =>
    counts.set(name, (counts.get(name) ?? 0) + 1);

  const ordered = [...events].sort(
    (a, b) => Number(a.basis !== "leaderboard") - Number(b.basis !== "leaderboard"),
  );
  for (const event of ordered) {
    const tournamentId = tournamentIds.get(event.pageTitle);
    if (tournamentId === undefined) {
      unscheduled.push(event.pageTitle);
      continue;
    }
    for (const entry of event.entries) {
      const match = players.match(entry.candidates);
      if (match.kind === "unmatched") {
        tally(unmatched, entry.name);
        continue;
      }
      if (match.kind === "ambiguous") {
        tally(ambiguous, entry.name);
        continue;
      }
      const key = `${match.playerId}:${tournamentId}`;
      const existing = byKey.get(key);
      // Already held from a leaderboard, or matched twice in one table: the first reading
      // stands, and a second is not allowed to overwrite it.
      if (existing !== undefined) continue;
      const [round1, round2, round3, round4] = entry.rounds ?? [null, null, null, null];
      byKey.set(key, {
        playerId: match.playerId,
        tournamentId,
        position: entry.finish.position,
        basis: event.basis,
        finish: entry.finish.finish,
        round1,
        round2,
        round3,
        round4,
        source: "wikipedia",
        sourceUrl: event.sourceUrl,
      });
    }
  }
  return { records: [...byKey.values()], unmatched, ambiguous, unscheduled };
}

/**
 * The season's Tournaments, keyed by the article title the schedule links each to, so that
 * results read from a table linking the same article can be attached to them. Rows missing
 * for the season are inserted from the schedule; rows already there are left exactly as they
 * are, so this never overwrites what `ingest:schedule` resolved, such as a Course name.
 */
export async function ensureTournaments(
  database: Database,
  rows: readonly ScheduleRow[],
  season: number,
  sourceUrl: string,
): Promise<Map<string, number>> {
  const active = rows.filter((row) => !row.canceled);
  if (active.length === 0) return new Map();
  await database
    .insert(tournaments)
    .values(
      active.map((row) => ({
        name: row.name,
        season,
        startDate: row.startDate,
        endDate: row.endDate,
        location: row.location,
        source: "wikipedia" as const,
        sourceUrl,
      })),
    )
    .onConflictDoNothing({ target: [tournaments.name, tournaments.season] });

  const stored = await database
    .select({ id: tournaments.id, name: tournaments.name })
    .from(tournaments)
    .where(
      and(
        eq(tournaments.season, season),
        inArray(
          tournaments.name,
          active.map((row) => row.name),
        ),
      ),
    );
  const idByName = new Map(stored.map((t) => [t.name, t.id]));
  const ids = new Map<string, number>();
  for (const row of active) {
    const id = idByName.get(row.name);
    if (id !== undefined) ids.set(row.pageTitle, id);
  }
  return ids;
}

const BATCH_SIZE = 500;

/**
 * Upserts on the `(player_id, tournament_id)` unique index: running this twice with the same
 * records updates the rows in place rather than adding to them, which is what makes the
 * ingest idempotent.
 */
export async function upsertResults(
  database: Database,
  records: readonly ResultRecord[],
): Promise<void> {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    await database
      .insert(results)
      .values(records.slice(i, i + BATCH_SIZE))
      .onConflictDoUpdate({
        target: [results.playerId, results.tournamentId],
        set: {
          position: sql`excluded.position`,
          basis: sql`excluded.basis`,
          finish: sql`excluded.finish`,
          round1: sql`excluded.round_1`,
          round2: sql`excluded.round_2`,
          round3: sql`excluded.round_3`,
          round4: sql`excluded.round_4`,
          source: sql`excluded.source`,
          sourceUrl: sql`excluded.source_url`,
          derivation: sql`excluded.derivation`,
          recordedAt: sql`now()`,
        },
      });
  }
}
