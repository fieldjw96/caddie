// Player Strengths that describe how a Player plays, derived from the round-by-round scores
// on full-field leaderboards. Pure: no database client, no network and no clock. See
// lib/strengths/derive.ts for Skill, Form and the venue record, which are derived from
// finishing positions and say how good a Player is, not what kind of game they have.
//
// Why these exist. Skill, Form and venue record all measure the same thing: how much of the
// field a Player beats. A Fit Score whose every Trait called for one of them could only ever
// rank Players by how good they are, reweighted. Four round scores say more than a finishing
// position does. 70-70-71-70 and 66-75-68-73 add up to the same total, and they are
// different games.
//
// THE TWO STRENGTHS
//
// - Consistency: how little a Player's rounds vary, once each round is set against the rest
//   of the field that day. Every round is standardised against that round's field: its
//   strokes minus the field's mean, over the field's standard deviation. A Player's raw
//   consistency is the standard deviation of their standardised rounds, across every event.
//   Lower is steadier. It is field-relative, so a hard Thursday, when everybody's scores rise
//   and spread, does not read as erratic play.
// - Low rounds: how often a Player goes low. The share of their rounds that were in the lowest
//   tenth of that round's field, ties at the boundary included. It is measured round by round
//   rather than as "their best round in each event", because a best-of-four is lower than a
//   best-of-two by arithmetic alone, and that would reward making cuts twice over.
//
// Both are then turned into the same scale as every other Strength: the share of the other
// Players with a stated value that this Player beats, ties counting half, from 0 to 1, where
// 0.5 is the middle. For Consistency, beating someone means a smaller spread; for Low rounds,
// a higher rate. So "Consistency 80%" means steadier than four in five of the Players we can
// say anything about, which is what lib/fit.ts's edge arithmetic expects.
//
// A third candidate, attrition (weekend rounds against a Player's own first two), was left
// out: it exists only for events where the cut was made, so it is measured on a Player's good
// weeks alone, and it rests on half the rounds the other two do. With about ten full-field
// events on record, that is noise wearing a number's clothes.
//
// Low rounds is not independent of Skill: a better Player goes low more often. It is still a
// different quantity, counted in rounds rather than finishes, and it separates a Player who
// posts steady top-twenty weeks from one who alternates a 65 with a 75.
//
// WHICH ROUNDS COUNT
//
// Only `leaderboard` rows have rounds: a `standings` row has none, and the database refuses
// them. Of a leaderboard row:
//
// - A finisher (any finishing position): every round with a score. A round the Source printed
//   no score for is left out, never filled in with an average or a guess.
// - A missed cut (`CUT`, `MC`): rounds 1 and 2 and nothing else. A missed cut is two rounds,
//   not four; reading its empty weekend as anything would be the obvious way to get this wrong.
// - A withdrawal, disqualification or non-finish (`WD`, `DQ`, `DNF`, `DNS`, `MDF`): no rounds.
//   The same rule as Skill: a round played injured, or a card that was not signed for, says
//   more about the injury or the ruling than about the Player's game.
//
// The rounds that count for a Player are also the only ones that make up a round's field, so
// every round is set against the same kind of round. A round whose field holds fewer than
// MINIMUM_ROUND_FIELD scores, or whose scores are all the same, is not used: there is no
// spread to stand against.
//
// THE FIELD IS WHAT IS STORED
//
// A leaderboard line whose name matched no `players` row was never stored, so a round's field
// is the stored Players who played it, not everybody who did. Those are the Players with a
// Wikidata PGA Tour identifier, most of any tour field, and missing the rest moves a mean or a
// tenth by less than it moves anyone's standing.
//
// THE SAMPLE
//
// `sampleSize` is the number of events a Player has at least one counted round in, and below
// MINIMUM_SAMPLE the value is null, the same rule and the same figure as every other Strength.
// Events, not rounds, because rounds within one week are not independent draws: the same
// course, weather and state of the Player's game. The rounds behind it are named in the
// derivation. Out of scope, as for Skill: any adjustment for the strength of a field beyond
// who was in it.

import type { ResultBasis } from "../../db/schema";
import { MINIMUM_SAMPLE, type Strength, type StoredResult } from "./derive";

/** A round's field needs this many scores to set a round against. */
export const MINIMUM_ROUND_FIELD = 10;

/** A round in the lowest this-share of its field is a low round. */
export const LOW_ROUND_SHARE = 0.1;

/** Finishes that played rounds 1 and 2 and no more. */
const MISSED_CUT = new Set(["CUT", "MC"]);

/** Four rounds in order, the strokes the Source printed, or null where it printed none. */
export type RoundScores = readonly [number | null, number | null, number | null, number | null];

/** A stored result with its round scores, as `loadResults` reads it. */
export interface RoundedResult extends StoredResult {
  rounds: RoundScores;
}

/** One round a Player played that counts. `round` is 1 to 4. */
export interface CountedRound {
  round: number;
  strokes: number;
}

/** The rounds of a result that count, by the rules in the header. */
export function countedRounds(result: RoundedResult): CountedRound[] {
  if (result.basis !== "leaderboard") return [];
  let played: number;
  if (MISSED_CUT.has(result.finish)) played = 2;
  else if (result.position !== null) played = 4;
  else return [];
  return result.rounds.slice(0, played).flatMap((strokes, i) =>
    strokes === null ? [] : [{ round: i + 1, strokes }],
  );
}

/** One round's field: every counted score in it, lowest first, and its spread. */
export interface RoundField {
  scores: number[];
  mean: number;
  sd: number;
}

const roundKey = (tournamentId: number, round: number) => `${tournamentId}:${round}`;

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation. Needs at least two values. */
function sampleSd(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

/**
 * Every usable round's field, from every Player's counted rounds, keyed `tournamentId:round`.
 * A round with too few scores, or none of them different, is absent.
 */
export function roundFields(rows: readonly RoundedResult[]): Map<string, RoundField> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    for (const { round, strokes } of countedRounds(row)) {
      const key = roundKey(row.tournamentId, round);
      const group = grouped.get(key);
      if (group) group.push(strokes);
      else grouped.set(key, [strokes]);
    }
  }
  const fields = new Map<string, RoundField>();
  for (const [key, scores] of grouped) {
    if (scores.length < MINIMUM_ROUND_FIELD) continue;
    const sd = sampleSd(scores);
    if (sd === 0) continue;
    fields.set(key, { scores: [...scores].sort((a, b) => a - b), mean: mean(scores), sd });
  }
  return fields;
}

/** Whether `strokes` is in the lowest LOW_ROUND_SHARE of `field`, ties at the edge included. */
export function isLowRound(strokes: number, field: RoundField): boolean {
  const better = field.scores.filter((s) => s < strokes).length;
  return better + 1 <= Math.ceil(field.scores.length * LOW_ROUND_SHARE);
}

/** One Player's measures before they are set against other Players'. */
export interface RawRoundMeasures {
  /** Events with at least one usable round: the sample size. */
  events: number;
  rounds: number;
  tournamentIds: number[];
  /** Standard deviation of the standardised rounds; null with fewer than two rounds. */
  spread: number | null;
  /** Share of rounds in the lowest tenth of their field; null with no rounds. */
  lowRate: number | null;
}

/** One Player's raw measures from their own results, against every round's field. */
export function rawRoundMeasures(
  results: readonly RoundedResult[],
  fields: ReadonlyMap<string, RoundField>,
): RawRoundMeasures {
  const standardised: number[] = [];
  let low = 0;
  const tournaments = new Set<number>();
  for (const result of results) {
    for (const { round, strokes } of countedRounds(result)) {
      const field = fields.get(roundKey(result.tournamentId, round));
      if (field === undefined) continue;
      standardised.push((strokes - field.mean) / field.sd);
      if (isLowRound(strokes, field)) low += 1;
      tournaments.add(result.tournamentId);
    }
  }
  const rounds = standardised.length;
  return {
    events: tournaments.size,
    rounds,
    tournamentIds: [...tournaments].sort((a, b) => a - b),
    spread: rounds >= 2 ? sampleSd(standardised) : null,
    lowRate: rounds > 0 ? low / rounds : null,
  };
}

/**
 * The share of `others` that `mine` beats, ties counting half, or null with nobody to beat.
 * `better` says whether a lower raw value is the better one.
 */
export function shareBeaten(
  mine: number,
  others: readonly number[],
  better: "lower" | "higher",
): number | null {
  if (others.length === 0) return null;
  let beaten = 0;
  for (const other of others) {
    if (other === mine) beaten += 0.5;
    else if (better === "lower" ? mine < other : mine > other) beaten += 1;
  }
  return beaten / others.length;
}

export interface RoundStrengths {
  consistency: Strength;
  lowRounds: Strength;
}

const EVENTS_ONLY: Record<ResultBasis, number> = { leaderboard: 0, standings: 0 };

/**
 * Every named Player's Consistency and Low rounds, as of a day. Takes every Player's rows at
 * once, because a round's field and the Players to be set against are everybody's.
 */
export function deriveRoundStrengths(
  rows: readonly RoundedResult[],
  asOf: string,
  playerIds: readonly number[],
): Map<number, RoundStrengths> {
  const played = rows.filter((r) => r.endDate <= asOf);
  const fields = roundFields(played);
  const byPlayer = new Map<number, RoundedResult[]>();
  for (const row of played) {
    const group = byPlayer.get(row.playerId);
    if (group) group.push(row);
    else byPlayer.set(row.playerId, [row]);
  }

  const raw = new Map(
    playerIds.map((id) => [id, rawRoundMeasures(byPlayer.get(id) ?? [], fields)] as const),
  );
  const qualified = [...raw].filter(([, m]) => m.events >= MINIMUM_SAMPLE);
  const spreads = qualified.flatMap(([id, m]) => (m.spread === null ? [] : [{ id, v: m.spread }]));
  const lowRates = qualified.flatMap(([id, m]) =>
    m.lowRate === null ? [] : [{ id, v: m.lowRate }],
  );

  const strength = (
    name: "consistency" | "low_rounds",
    measures: RawRoundMeasures,
    id: number,
    cohort: readonly { id: number; v: number }[],
    better: "lower" | "higher",
    what: string,
  ): Strength => {
    const mine = cohort.find((c) => c.id === id);
    const others = cohort.filter((c) => c.id !== id).map((c) => c.v);
    const value = mine === undefined ? null : shareBeaten(mine.v, others, better);
    const counted =
      `${measures.events} event${measures.events === 1 ? "" : "s"} with usable rounds ` +
      `(${measures.rounds} round${measures.rounds === 1 ? "" : "s"})`;
    const from =
      measures.tournamentIds.length > 0
        ? `, from Wikipedia full-field leaderboards (CC BY-SA 4.0) at tournaments ${measures.tournamentIds.map((t) => `#${t}`).join(", ")}`
        : "";
    const derivation =
      value === null
        ? measures.events < MINIMUM_SAMPLE
          ? `${name}: no value, ${counted}${from}, fewer than the minimum of ${MINIMUM_SAMPLE} events.`
          : `${name}: no value, ${counted}${from}, but no other Player has enough rounds to set it against.`
        : `${name}: share of the other ${others.length} Players with a value beaten on ${what}, ` +
          `rounds to ${asOf}: ${counted}${from}. Each round set against that round's field; ` +
          `missed cuts count two rounds; withdrawals and disqualifications left out.`;
    return {
      strength: name,
      value,
      sampleSize: measures.events,
      byBasis: { ...EVENTS_ONLY, leaderboard: measures.events },
      tournamentIds: measures.tournamentIds,
      derivation,
    };
  };

  const derived = new Map<number, RoundStrengths>();
  for (const [id, measures] of raw) {
    derived.set(id, {
      consistency: strength(
        "consistency",
        measures,
        id,
        spreads,
        "lower",
        "the spread of their field-standardised rounds, smaller beating larger",
      ),
      lowRounds: strength(
        "low_rounds",
        measures,
        id,
        lowRates,
        "higher",
        "the share of their rounds in the lowest tenth of that round's field",
      ),
    });
  }
  return derived;
}
