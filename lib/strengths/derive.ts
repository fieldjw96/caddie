// Player Strengths, derived from the finishing positions already stored in `results`. Pure:
// no database client, no network and no clock. Results, fields and the date to derive as of
// are all arguments. See CONTEXT.md's Player Strength and Derived, and docs/adr/0002 for why
// finishing positions are all there is to derive from.
//
// THE THREE STRENGTHS
//
// - Skill: the mean score (below) across every stored result up to the as-of date.
// - Form: the same mean over results from events that ended in the FORM_WINDOW_DAYS days up
//   to and including the as-of date, and no others. 180 days is about half a season: long
//   enough to hold the spring majors and signature events when deriving in late summer,
//   short enough that last year's season is not called form.
// - Venue record: the same mean over results at one Course, the next Tournament's, whenever
//   they were.
//
// Every Strength carries `sampleSize`, the number of results its mean rests on, and is null
// below MINIMUM_SAMPLE. Null is the answer, not a failure: a Player with two finishes has no
// Skill we can state, and nothing here fills the gap with a population average or a zero.
//
// MAKING FINISHES COMPARABLE
//
// A 10th of 156 and a 10th of 30 are not the same achievement, so a position is never
// averaged as it stands. Each result is scored as the share of the rest of the field the
// Player finished ahead of: (fieldSize - position) / (fieldSize - 1). A win scores 1, last
// place 0, and 10th of 156 scores 0.94 where 10th of 30 scores 0.69. A tie shares the best
// position of the tie, as the Source prints it, so tied Players score alike.
//
// The field size is not stored, so `fieldsFromResults` estimates it from every stored row of
// the event, all Players at once: at least the number of rows, and at least the last
// finishing position plus the Players with no position. Because a name that matched no
// `players` row was never stored, the estimate is a lower bound, never an inflation.
//
// A missed cut (`CUT`, `MC`) is information, so it counts: it is ranked tied behind every
// finisher, at position (finishers + 1). A withdrawal, disqualification or non-finish (`WD`,
// `DQ`, `DNF`, `DNS`, `MDF`) says more about an injury or a ruling than about a Player's
// golf, so it is left out of the sample and does not count towards `sampleSize`.
//
// STANDINGS ROWS AGAINST LEADERBOARD ROWS
//
// Every score keeps its `basis`, and each Strength's derivation says how many of each it
// rests on. They are weighted equally, for two reasons. The bias in the standings table is in
// which Players appear, not in which of their results do: for a Player in the top 30, it
// records every one of their finishes in those events, missed cuts included, so it is not a
// flattering selection of that Player's weeks. The minimum sample handles the rest: a Player
// is not given a number for being in the table, only for having enough finishes in it.
//
// The cost is stated rather than hidden: an event read only from the standings table has
// only the top 30's rows to estimate its field from, so its field is a looser lower bound and
// a poor finish there scores lower than it would against the true field. That makes these
// scores, if anything, harsh, never generous.
//
// Out of scope, deliberately: any adjustment for the strength of a field beyond its size.

import { STRENGTH_MINIMUM_SAMPLE, type ResultBasis } from "../../db/schema";

/**
 * Fewer results than this and a Strength is null. A single score is spread roughly evenly
 * across 0 to 1, a standard deviation of about 0.29, so the mean of n of them is uncertain by
 * about 0.29 / sqrt(n). At two results that is 0.2, and a 95% interval covers most of the
 * scale: noise wearing a number's clothes. At five it is 0.13, still wide, but narrow enough
 * to tell a Player who habitually finishes in the top quarter from one who habitually finishes
 * in the bottom quarter. Five is also most of a season's openly-licensed full-field events
 * (docs/adr/0002), so it asks for a real record without asking for one nobody has.
 *
 * The figure is defined in db/schema.ts, because the database checks it too, in
 * `player_strengths_value_needs_minimum_sample`, and refuses a value resting on fewer.
 */
export const MINIMUM_SAMPLE = STRENGTH_MINIMUM_SAMPLE;

/** Form's window: events that ended in these many days up to the as-of date. See the header. */
export const FORM_WINDOW_DAYS = 180;

/** Finishes that rank a Player behind every finisher, and count. */
const MISSED_CUT = new Set(["CUT", "MC"]);

export type StrengthName = "skill" | "form" | "venue_record";

/** One stored result, as much of a `results` row, joined to its Tournament, as this needs. */
export interface StoredResult {
  playerId: number;
  tournamentId: number;
  /** The Tournament's Course, where known. */
  courseId: number | null;
  /** The Tournament's last day, `YYYY-MM-DD`. */
  endDate: string;
  basis: ResultBasis;
  /** The Source's own label: `T14`, `CUT`, `WD`. */
  finish: string;
  position: number | null;
}

/** What is known of one event's field, estimated from every stored row of it. */
export interface Field {
  /** Players known to have teed off. A lower bound: see the header. */
  size: number;
  /** Players known to have a finishing position. Also a lower bound. */
  finishers: number;
}

export interface Strength {
  strength: StrengthName;
  /** The mean share of the field beaten, 0 to 1, or null below MINIMUM_SAMPLE. */
  value: number | null;
  /** How many results the value rests on, or would have. Always present, including when null. */
  sampleSize: number;
  /** How many of those came from each kind of table. */
  byBasis: Record<ResultBasis, number>;
  /** The tournaments the sample came from, for the derivation. */
  tournamentIds: number[];
  /** What the value was derived from, in words: stored as `player_strengths.derivation`. */
  derivation: string;
}

export interface PlayerStrengths {
  skill: Strength;
  form: Strength;
  /** Null when there is no Course to hold a record at: the next Tournament's is unknown. */
  venueRecord: Strength | null;
}

export interface DeriveOptions {
  /** The day to derive as of, `YYYY-MM-DD`. Results from events ending after it are ignored. */
  asOf: string;
  /** The Course a venue record is wanted for, or null for none. */
  courseId: number | null;
}

/** Every event's field, estimated from all Players' stored rows of it. */
export function fieldsFromResults(rows: readonly StoredResult[]): Map<number, Field> {
  const grouped = new Map<number, StoredResult[]>();
  for (const row of rows) {
    const group = grouped.get(row.tournamentId);
    if (group) group.push(row);
    else grouped.set(row.tournamentId, [row]);
  }
  const fields = new Map<number, Field>();
  for (const [tournamentId, group] of grouped) {
    const positioned = group.filter((r) => r.position !== null);
    const lastPosition = Math.max(0, ...positioned.map((r) => r.position ?? 0));
    const finishers = Math.max(lastPosition, positioned.length);
    const size = Math.max(group.length, finishers + (group.length - positioned.length));
    fields.set(tournamentId, { size, finishers });
  }
  return fields;
}

/**
 * One result's score, the share of the rest of the field finished ahead of, or null if the
 * result is not usable: a withdrawal, a disqualification, or an event whose field is unknown
 * or too small to rank within.
 */
export function scoreResult(result: StoredResult, field: Field | undefined): number | null {
  if (field === undefined || field.size < 2) return null;
  let position: number;
  if (result.position !== null) position = result.position;
  else if (MISSED_CUT.has(result.finish)) position = field.finishers + 1;
  else return null;
  if (position < 1 || position > field.size) return null;
  return (field.size - position) / (field.size - 1);
}

/** The day `days` before `date`, both `YYYY-MM-DD`, in UTC. */
function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`"${date}" is not a YYYY-MM-DD date`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function strengthOf(
  strength: StrengthName,
  results: readonly StoredResult[],
  fields: ReadonlyMap<number, Field>,
  describe: string,
): Strength {
  const scored = results.flatMap((r) => {
    const score = scoreResult(r, fields.get(r.tournamentId));
    return score === null ? [] : [{ result: r, score }];
  });
  const sampleSize = scored.length;
  const byBasis: Record<ResultBasis, number> = { leaderboard: 0, standings: 0 };
  for (const { result } of scored) byBasis[result.basis] += 1;
  const tournamentIds = [...new Set(scored.map((s) => s.result.tournamentId))].sort(
    (a, b) => a - b,
  );
  const value =
    sampleSize >= MINIMUM_SAMPLE
      ? scored.reduce((sum, s) => sum + s.score, 0) / sampleSize
      : null;

  const counted =
    `${sampleSize} usable result${sampleSize === 1 ? "" : "s"} ` +
    `(${byBasis.leaderboard} from full-field leaderboards, ${byBasis.standings} from the FedEx Cup standings and playoffs tables)`;
  const from =
    tournamentIds.length > 0
      ? `, from Wikipedia results (CC BY-SA 4.0) at tournaments ${tournamentIds.map((id) => `#${id}`).join(", ")}`
      : "";
  const derivation =
    value === null
      ? `${strength}: no value, ${describe}: ${counted}${from}, fewer than the minimum of ${MINIMUM_SAMPLE}.`
      : `${strength}: mean share of the field beaten, ${describe}: ${counted}${from}. ` +
        `Missed cuts ranked behind every finisher; withdrawals and disqualifications left out.`;

  return { strength, value, sampleSize, byBasis, tournamentIds, derivation };
}

/**
 * One Player's Strengths from their own stored results. `fields` comes from
 * `fieldsFromResults` over every Player's rows, since one Player's rows cannot say how big
 * the fields they played in were.
 */
export function deriveStrengths(
  results: readonly StoredResult[],
  fields: ReadonlyMap<number, Field>,
  options: DeriveOptions,
): PlayerStrengths {
  const { asOf, courseId } = options;
  const formStart = daysBefore(asOf, FORM_WINDOW_DAYS);
  const played = results.filter((r) => r.endDate <= asOf);

  return {
    skill: strengthOf("skill", played, fields, `every stored result to ${asOf}`),
    form: strengthOf(
      "form",
      played.filter((r) => r.endDate > formStart),
      fields,
      `events ending in the ${FORM_WINDOW_DAYS} days to ${asOf}`,
    ),
    venueRecord:
      courseId === null
        ? null
        : strengthOf(
            "venue_record",
            played.filter((r) => r.courseId === courseId),
            fields,
            `every stored result at course #${courseId} to ${asOf}`,
          ),
  };
}
