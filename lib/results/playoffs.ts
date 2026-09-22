// The season's "FedEx Cup Playoffs" article, and its "Table of qualified players": every
// Player who qualified for the playoffs, and their finish in each of its three events, the
// FedEx St. Jude Championship, the BMW Championship and the Tour Championship. Those events
// have no leaderboard article of their own, and the season's standings table, which covers
// them for the top 30 only, appears only once the season is over. This table is written up as
// the playoffs are played, and it is each event's whole field, not its top 30.
//
// Rows from it are stored with basis `standings`: finishes, with no round scores, read from a
// season-level table rather than from an event's own leaderboard. Each row's `sourceUrl` is
// this article's revision, which is how a run tells them apart from the standings table's.
//
// A cell reads `{{nts|12|prefix=T}}` for a finish, and a dash, after an `{{ntsh}}` sort key,
// for a Player who did not advance to that event, which is no Result at all. Each event's
// column is read on its own: a cell that fails its schema costs that one event.

import { z } from "zod";
import { finishSchema, stripCellMarkup } from "./finish";
import { withoutDisambiguator } from "./names";
import type { StandingsParse } from "./standings";
import type { EventFailure, EventResults, ParsedEntry } from "./types";
import { firstWikilink, rowCells, tableRows, tables } from "./wikitext";

const SECTION = "Table of qualified players";

/** Flag, Player, points, rank, then a finish and a rank after it for each of three events. */
const CELLS_PER_ROW = 10;
const FINISH_COLUMNS = [4, 6, 8] as const;

/** The Tour Championship's field: fewer qualifiers than this is a table misread. */
const MINIMUM_ROWS = 30;

/** A cell for an event the Player did not play: not advanced (a dash), or `DNP`. */
const DID_NOT_PLAY = /^(?:[-–—]|DNP)?$/;

const HEADING = /^(=+)\s*(.+?)\s*\1\s*$/gm;

function sectionUnder(wikitext: string, name: string): string | null {
  const headings = [...wikitext.matchAll(HEADING)];
  const index = headings.findIndex((h) => h[2]!.toLowerCase() === name.toLowerCase());
  if (index === -1) return null;
  const start = headings[index]!.index! + headings[index]![0].length;
  const end = headings[index + 1]?.index ?? wikitext.length;
  return wikitext.slice(start, end);
}

/** `{{nts|12|prefix=T}}` to `T12`, `{{nts|1}}` to `1`, and an `{{ntsh|..}}` sort key dropped. */
function finishLabel(cell: string): string {
  return stripCellMarkup(
    cell
      .replace(/\{\{\s*ntsh\s*\|[^}]*\}\}/gi, "")
      .replace(
        /\{\{\s*nts\s*\|\s*([0-9]+)\s*(?:\|\s*prefix\s*=\s*([^|}]*))?\}\}/gi,
        (_, n: string, prefix?: string) => `${prefix?.trim() ?? ""}${n}`,
      ),
  );
}

/**
 * The Player cell: `{{sortname|First|Last|dab=golfer}}`, `{{sortname|Im|Sung-jae||Im,
 * Sung-jae}}`, or a plain `[[link]]`, with a trailing `*` for a first-time qualifier.
 */
function parsePlayerCell(cell: string): { name: string; candidates: string[] } {
  const sortname = /\{\{\s*sortname\s*\|([^}]*)\}\}/i.exec(cell);
  if (sortname) {
    const params = sortname[1]!.split("|").map((p) => p.trim());
    const positional = params.filter((p) => !p.includes("="));
    const dab = params.find((p) => p.startsWith("dab="))?.slice(4);
    const name = `${positional[0] ?? ""} ${positional[1] ?? ""}`.trim();
    const target = positional[2] || (dab ? `${name} (${dab})` : name);
    return { name, candidates: [...new Set([withoutDisambiguator(target), name])] };
  }
  const link = firstWikilink(cell);
  if (link) {
    const target = withoutDisambiguator(link.target);
    return {
      name: stripCellMarkup(link.label),
      candidates: [...new Set([target, stripCellMarkup(link.label)])],
    };
  }
  const name = stripCellMarkup(cell).replace(/\*$/, "").trim();
  return { name, candidates: name === "" ? [] : [name] };
}

const rowSchema = z.object({
  player: z.object({
    name: z.string().min(1, "the Player cell has no name"),
    candidates: z.array(z.string().min(1)).min(1),
  }),
  finish: finishSchema,
});

/**
 * The playoffs article's wikitext, parsed into one `EventResults` per event whose column it
 * could read and one `EventFailure` per event it could not. Throws when the table as a whole
 * is unreadable: no such section, no event links in its header, or too few rows.
 */
export function parsePlayoffs(articleWikitext: string): StandingsParse {
  const section = sectionUnder(articleWikitext, SECTION);
  if (section === null) throw new Error(`The article has no "${SECTION}" section.`);
  const table = tables(section)[0];
  if (table === undefined) throw new Error(`The "${SECTION}" section has no wikitable.`);

  const rows = tableRows(table);
  const targets = rowCells(rows[0] ?? "")
    .map((cell) => firstWikilink(cell.value)?.target)
    .filter((target): target is string => target !== undefined);
  if (targets.length !== FINISH_COLUMNS.length) {
    throw new Error(
      `The "${SECTION}" header links ${targets.length} events, expected ${FINISH_COLUMNS.length}: ${targets.join(", ")}`,
    );
  }

  const playerRows = rows
    // `{{sortname|Im|Sung-jae||Im, Sung-jae}}` has an empty parameter, and `||` is otherwise
    // read as two cells on one line.
    .map((row) =>
      rowCells(
        row.replace(/\{\{\s*sortname\s*\|[^}]*\}\}/gi, (t) => t.replaceAll("||", "| |")),
      ),
    )
    .filter((cells) => cells.some((cell) => /\{\{\s*flagicon/i.test(cell.value)));
  if (playerRows.length < MINIMUM_ROWS) {
    throw new Error(
      `The "${SECTION}" table has ${playerRows.length} Players, fewer than the ${MINIMUM_ROWS} of the Tour Championship.`,
    );
  }

  const events: EventResults[] = [];
  const failures: EventFailure[] = [];
  FINISH_COLUMNS.forEach((column, i) => {
    const pageTitle = targets[i]!;
    const entries: ParsedEntry[] = [];
    for (const [line, cells] of playerRows.entries()) {
      const player = parsePlayerCell(cells[1]?.value ?? "");
      if (cells.length !== CELLS_PER_ROW) {
        failures.push({
          pageTitle,
          basis: "standings",
          reason: `line ${line + 1} (${player.name}) has ${cells.length} cells, expected ${CELLS_PER_ROW}.`,
        });
        return;
      }
      const label = finishLabel(cells[column]!.value);
      if (DID_NOT_PLAY.test(label)) continue;
      const parsed = rowSchema.safeParse({ player, finish: label });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        failures.push({
          pageTitle,
          basis: "standings",
          reason: `line ${line + 1} (${player.name}), field "${issue?.path.join(".")}": ${issue?.message}`,
        });
        return;
      }
      entries.push({ ...parsed.data.player, finish: parsed.data.finish, rounds: null });
    }
    events.push({ pageTitle, basis: "standings", entries });
  });
  return { events, failures };
}

/** The page title a whole-table failure is reported under. */
export const PLAYOFFS_TABLE = "FedEx Cup Playoffs qualified players table";

/** `parsePlayoffs` for a run: a table unreadable as a whole is one failure, never the run. */
export function readPlayoffs(articleWikitext: string): StandingsParse {
  try {
    return parsePlayoffs(articleWikitext);
  } catch (error) {
    return {
      events: [],
      failures: [
        {
          pageTitle: PLAYOFFS_TABLE,
          basis: "standings",
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
