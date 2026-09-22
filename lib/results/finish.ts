// One finishing-position cell, as both the standings table and an event leaderboard print it,
// crossed through Zod. Every label this accepts is one the Source's own legend explains; any
// other label fails naming the cell, rather than becoming a position nobody chose.

import { z } from "zod";

/** A finish as stored: the Source's own label, and the position it means, if it means one. */
export interface Finish {
  /** `1`, `T14`, `CUT`, `WD`, `DQ`, `MDF`, exactly as the Source labels it, less its markup. */
  finish: string;
  /** The finishing position, shared by a tie. Null for a Player with no finishing position. */
  position: number | null;
}

/** Labels for a Player who teed off and has no finishing position. */
const NO_POSITION = ["CUT", "MC", "WD", "DQ", "DNF", "MDF", "DNS"] as const;

/**
 * Wikitext markup a finish cell is wrapped in: bold (a win), `{{tooltip|WD|Withdrew}}`, a
 * wikilink to the event (`[[Charles Schwab Challenge|T4]]`). Stripped to the label it shows.
 */
export function stripCellMarkup(cell: string): string {
  return cell
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{\s*(?:tooltip|abbr)\s*\|([^|}]*)\|[^}]*\}\}/gi, "$1")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/&nbsp;|\{\{nbsp\}\}/g, " ")
    .trim();
}

export const finishSchema = z
  .string()
  .transform(stripCellMarkup)
  .pipe(
    z
      .string()
      .regex(
        new RegExp(`^(?:T?[1-9][0-9]*|${NO_POSITION.join("|")})$`),
        `expected a finishing position ("7", "T14") or one of ${NO_POSITION.join(", ")}`,
      ),
  )
  .transform((label): Finish => {
    const position = /^T?([1-9][0-9]*)$/.exec(label);
    return { finish: label, position: position ? Number(position[1]) : null };
  });
