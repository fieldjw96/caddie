// Reads the stored results Strengths are derived from, and replaces the stored Strengths with
// freshly derived ones. The derivations themselves are lib/strengths/derive.ts and
// lib/strengths/rounds.ts, which touch neither this nor any database.

import { eq } from "drizzle-orm";
import type { db as dbClient } from "../../db/client";
import { playerStrengths, results, tournaments } from "../../db/schema";
import type { PlayerStrengths } from "./derive";
import type { RoundedResult, RoundStrengths } from "./rounds";

type Database = typeof dbClient;

/** Every stored result, with its round scores, joined to the Tournament it was in. */
export async function loadResults(database: Database): Promise<RoundedResult[]> {
  const rows = await database
    .select({
      playerId: results.playerId,
      tournamentId: results.tournamentId,
      courseId: tournaments.courseId,
      endDate: tournaments.endDate,
      basis: results.basis,
      finish: results.finish,
      position: results.position,
      round1: results.round1,
      round2: results.round2,
      round3: results.round3,
      round4: results.round4,
    })
    .from(results)
    .innerJoin(tournaments, eq(results.tournamentId, tournaments.id));
  return rows.map(({ round1, round2, round3, round4, ...row }) => ({
    ...row,
    rounds: [round1, round2, round3, round4],
  }));
}

/** The `strength` key a Strength is stored under. A venue record is keyed by its Course. */
export function strengthKey(strength: string, courseId: number | null): string {
  return strength === "venue_record" ? `venue_record:course:${courseId}` : strength;
}

export interface StrengthRecord {
  playerId: number;
  strength: string;
  value: number | null;
  sampleSize: number;
  source: "derived";
  derivation: string;
}

/**
 * The rows to store for each Player: one per Strength, null values included, because "no
 * record" is an answer the page shows along with the sample size behind it.
 */
export function strengthRecords(
  derived: ReadonlyMap<number, PlayerStrengths>,
  courseId: number | null,
  fromRounds: ReadonlyMap<number, RoundStrengths> = new Map(),
): StrengthRecord[] {
  const records: StrengthRecord[] = [];
  for (const [playerId, strengths] of derived) {
    const rounds = fromRounds.get(playerId);
    for (const s of [
      strengths.skill,
      strengths.form,
      strengths.venueRecord,
      rounds?.consistency ?? null,
      rounds?.lowRounds ?? null,
    ]) {
      if (s === null) continue;
      records.push({
        playerId,
        strength: strengthKey(s.strength, courseId),
        value: s.value,
        sampleSize: s.sampleSize,
        source: "derived",
        derivation: s.derivation,
      });
    }
  }
  return records;
}

const BATCH_SIZE = 500;

/**
 * Replaces every stored Strength in one transaction. Replacing rather than upserting is what
 * removes a venue record for last week's Course, and a reader never sees half of each set.
 */
export async function replaceStrengths(
  database: Database,
  records: readonly StrengthRecord[],
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.delete(playerStrengths);
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      await tx.insert(playerStrengths).values(records.slice(i, i + BATCH_SIZE));
    }
  });
}
