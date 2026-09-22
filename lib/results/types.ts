import type { ResultBasis } from "../../db/schema";
import type { Finish } from "./finish";

/** Four rounds in order, each the strokes the Source prints, or null where it prints none. */
export type Rounds = [number | null, number | null, number | null, number | null];

/** One Player's line in one event, as read, before any `players` row has been matched to it. */
export interface ParsedEntry {
  /** The name as the table shows it, for reporting a miss in terms a reader can look up. */
  name: string;
  /** Spellings to match a `players` row on, most specific first. */
  candidates: string[];
  finish: Finish;
  /** Null for a standings row, which carries no scores at all. */
  rounds: Rounds | null;
}

/** One event's results from one table, keyed by the event's Wikipedia article title. */
export interface EventResults {
  /** The article the season schedule links the event to: how it is matched to a Tournament. */
  pageTitle: string;
  basis: ResultBasis;
  entries: ParsedEntry[];
}

/** One event a table should have yielded and did not, and why. Costs that event, not the run. */
export interface EventFailure {
  pageTitle: string;
  basis: ResultBasis;
  reason: string;
}
