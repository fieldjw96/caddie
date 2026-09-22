// The season article's FedEx Cup standings table: the top 30 Players' finishes in every major,
// the Players, every signature event and the playoffs. The best open source of results this
// repo has, and a biased one, because a Player is only in it for having had a good season.
//
// Each data row is split by the HTML comments the table's editors use as row markers
// (`<!--MajorsPly-->`, `<!--Signature-->`, `<!--PlayoffEvents-->`, `<!--TourChampScore-->`),
// and each group's cells are assigned to the events its header links to, in order. A cell
// that fails its schema costs the one event whose column it is in.
//
// "Top 10s in other PGA Tour events" is read by nobody here on purpose. It lists a Player's
// top-10 finishes and nothing else, so a Result from it would be one a Player is only
// recorded for having done well, with no way to tell a bad week from a week not played.

import { z } from "zod";
import { finishSchema, stripCellMarkup } from "./finish";
import { withoutDisambiguator } from "./names";
import type { EventFailure, EventResults, ParsedEntry } from "./types";
import { firstWikilink, rowCells, tableRows, tables } from "./wikitext";

/** The marker groups read, and how many event columns each has. */
const GROUPS = [
  { marker: "MajorsPly", columns: 5 },
  { marker: "Signature", columns: 8 },
  { marker: "PlayoffEvents", columns: 2 },
] as const;

const TOUR_CHAMPIONSHIP_MARKER = "TourChampScore";

/** The legend's "Did not play". Not a Result: nothing is recorded for the event. */
const DID_NOT_PLAY = "•";

/** The table's own caption says it lists the Tour Championship's 30 qualifiers. */
const EXPECTED_PLAYERS = 30;

interface StandingsRow {
  player: { name: string; candidates: string[] };
  /** The FedEx Cup position cell, inherited from the row above when a tie spans rows. */
  position: string;
  /** The Tour Championship to-par cell, likewise inherited across a tie. */
  tourChampionshipScore: string;
  groups: Map<string, string>;
}

export interface StandingsParse {
  events: EventResults[];
  failures: EventFailure[];
}

const playerSchema = z.object({
  name: z.string().min(1, "the Player cell has no name"),
  candidates: z.array(z.string().min(1)).min(1),
});

const standingsCellSchema = z.object({ player: playerSchema, finish: finishSchema });

/** To par, as the Tour Championship column prints it: `−18`, `+3`, `E`. */
const toParSchema = z
  .string()
  .transform(stripCellMarkup)
  .pipe(z.string().regex(/^(?:[+−-][0-9]+|E)$/, 'expected a score to par ("−18", "+3", "E")'))
  .transform((label) => (label === "E" ? 0 : Number(label.replace("−", "-"))));

/** The standings wikitable, found by its own row markers rather than by its position. */
function isolateStandingsTable(sectionWikitext: string): string {
  const table = tables(sectionWikitext).find((t) => t.includes(`<!--${GROUPS[0].marker}-->`));
  if (!table) {
    throw new Error(
      `The Standings section has no wikitable carrying "<!--${GROUPS[0].marker}-->" row markers.`,
    );
  }
  return table;
}

/** The event article titles a header row's `{{abbr|[[Target|Abbr]]|...}}` cells link to. */
function headerTargets(headerRow: string): string[] {
  return [...headerRow.matchAll(/\{\{abbr\|\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g)].map((m) =>
    m[1]!.trim(),
  );
}

function splitMarkers(row: string): { lead: string; groups: Map<string, string> } {
  const parts = row.split(/<!--\s*([^>]*?)\s*-->/);
  const groups = new Map<string, string>();
  for (let i = 1; i < parts.length; i += 2) {
    const marker = parts[i]!.split(",")[0]!.trim();
    groups.set(marker, parts[i + 1] ?? "");
  }
  return { lead: parts[0] ?? "", groups };
}

function parsePlayerCell(cell: string): { name: string; candidates: string[] } {
  const link = firstWikilink(cell);
  if (link) {
    // The label is a surname only (`[[Tommy Fleetwood|Fleetwood]]`), which could match
    // anybody sharing it, so the link target is the only name this table is matched on.
    const name = withoutDisambiguator(link.target);
    return { name, candidates: [name] };
  }
  const name = stripCellMarkup(cell);
  return { name, candidates: name === "" ? [] : [name] };
}

function parseRows(table: string): StandingsRow[] {
  const rows: StandingsRow[] = [];
  let position: string | null = null;
  let tourChampionshipScore: string | null = null;

  for (const raw of tableRows(table)) {
    if (!raw.includes(`<!--${GROUPS[0].marker}-->`)) continue;
    const { lead, groups } = splitMarkers(raw);
    const leadCells = rowCells(lead);
    const playerCell = leadCells.at(-1);
    if (!playerCell) {
      throw new Error(`A standings row has no Player cell: ${JSON.stringify(lead)}`);
    }
    // Position, flag, name: a row with all three starts a new position; a row with only the
    // flag and the name continues a tie spanning rows from the one above.
    if (leadCells.length >= 3) {
      position = leadCells[0]!.value;
    }
    const tourChampionship = groups.get(TOUR_CHAMPIONSHIP_MARKER);
    if (tourChampionship !== undefined) {
      tourChampionshipScore = rowCells(tourChampionship)[0]?.value ?? "";
    }
    if (position === null || tourChampionshipScore === null) {
      throw new Error(
        `The first standings row (${stripCellMarkup(playerCell.value)}) carries no position or no Tour Championship score.`,
      );
    }
    rows.push({
      player: parsePlayerCell(playerCell.value),
      position,
      tourChampionshipScore,
      groups,
    });
  }
  return rows;
}

function failureMessage(error: z.ZodError, player: string, pageTitle: string): string {
  const issue = error.issues[0];
  const field = issue?.path.join(".") || "cell";
  return `${player}'s "${field}" for ${pageTitle}: ${issue?.message ?? "invalid"}`;
}

/** One event column, all 30 rows of it, or the reason it could not be read. */
function parseEventColumn(
  rows: readonly StandingsRow[],
  marker: string,
  columns: number,
  column: number,
  pageTitle: string,
): EventResults | EventFailure {
  const entries: ParsedEntry[] = [];
  for (const row of rows) {
    const cells = rowCells(row.groups.get(marker) ?? "");
    if (cells.length !== columns) {
      return {
        pageTitle,
        basis: "standings",
        reason: `${row.player.name}'s "${marker}" group has ${cells.length} cells, expected ${columns}.`,
      };
    }
    const value = cells[column]!.value;
    if (stripCellMarkup(value) === DID_NOT_PLAY) continue;
    const parsed = standingsCellSchema.safeParse({ player: row.player, finish: value });
    if (!parsed.success) {
      return {
        pageTitle,
        basis: "standings",
        reason: failureMessage(parsed.error, row.player.name, pageTitle),
      };
    }
    entries.push({ ...parsed.data.player, finish: parsed.data.finish, rounds: null });
  }
  return { pageTitle, basis: "standings", entries };
}

/**
 * The Tour Championship, which has no event article, read from the standings' own position
 * column. Since 2025 the Tour Championship is a 72-hole stroke-play event from even par with
 * no starting strokes, so the final FedEx Cup position of its 30 Players is their finishing
 * position in it. That reading is only accepted if the table's own to-par column agrees with
 * it row for row: equal positions carry equal scores, and a worse position a worse score.
 */
function parseTourChampionship(
  rows: readonly StandingsRow[],
  pageTitle: string,
): EventResults | EventFailure {
  const schema = z.object({ player: playerSchema, finish: finishSchema, toPar: toParSchema });
  const parsed: { entry: ParsedEntry; position: number; toPar: number }[] = [];
  for (const row of rows) {
    const result = schema.safeParse({
      player: row.player,
      finish: row.position,
      toPar: row.tourChampionshipScore,
    });
    if (!result.success) {
      return {
        pageTitle,
        basis: "standings",
        reason: failureMessage(result.error, row.player.name, pageTitle),
      };
    }
    const { finish, player, toPar } = result.data;
    if (finish.position === null) {
      return {
        pageTitle,
        basis: "standings",
        reason: `${player.name}'s position "${finish.finish}" is not a finishing position.`,
      };
    }
    parsed.push({
      entry: { ...player, finish, rounds: null },
      position: finish.position,
      toPar,
    });
  }

  const byPosition = [...parsed].sort((a, b) => a.position - b.position);
  for (let i = 1; i < byPosition.length; i++) {
    const before = byPosition[i - 1]!;
    const after = byPosition[i]!;
    const agrees =
      before.position === after.position
        ? before.toPar === after.toPar
        : before.toPar < after.toPar;
    if (!agrees) {
      return {
        pageTitle,
        basis: "standings",
        reason: `the FedEx Cup positions disagree with the Tour Championship scores at ${before.entry.name} and ${after.entry.name}, so they cannot be read as its finishing order.`,
      };
    }
  }
  return { pageTitle, basis: "standings", entries: parsed.map((p) => p.entry) };
}

/**
 * The standings section's wikitext, parsed into one `EventResults` per event column it could
 * read and one `EventFailure` per event it could not. Throws only when the table as a whole is
 * unreadable: no marked rows, or headers that no longer line up with the marker groups.
 */
export function parseStandings(sectionWikitext: string): StandingsParse {
  const table = isolateStandingsTable(sectionWikitext);
  const allRows = tableRows(table);
  const [firstHeader, secondHeader] = allRows;
  if (firstHeader === undefined || secondHeader === undefined) {
    throw new Error("The standings table has fewer than two header rows.");
  }

  const expectedColumns = GROUPS.reduce((sum, group) => sum + group.columns, 0);
  const targets = headerTargets(secondHeader);
  if (targets.length !== expectedColumns) {
    throw new Error(
      `The standings header links ${targets.length} events, expected ${expectedColumns} ` +
        `(${GROUPS.map((g) => `${g.columns} ${g.marker}`).join(", ")}): ${targets.join(", ")}`,
    );
  }

  const rows = parseRows(table);
  if (rows.length !== EXPECTED_PLAYERS) {
    throw new Error(
      `The standings table has ${rows.length} marked rows, expected ${EXPECTED_PLAYERS}.`,
    );
  }

  const events: EventResults[] = [];
  const failures: EventFailure[] = [];
  const record = (outcome: EventResults | EventFailure) => {
    if ("entries" in outcome) events.push(outcome);
    else failures.push(outcome);
  };

  let offset = 0;
  for (const group of GROUPS) {
    for (let column = 0; column < group.columns; column++) {
      record(
        parseEventColumn(rows, group.marker, group.columns, column, targets[offset + column]!),
      );
    }
    offset += group.columns;
  }

  const tourChampionship = headerTargets(firstHeader).find((t) => /Tour Championship/.test(t));
  if (tourChampionship === undefined) {
    failures.push({
      pageTitle: "Tour Championship",
      basis: "standings",
      reason: "the standings header no longer links a Tour Championship column.",
    });
  } else {
    record(parseTourChampionship(rows, tourChampionship));
  }

  return { events, failures };
}

/** The page title a whole-table failure is reported under, having no one event to name. */
export const STANDINGS_TABLE = "FedEx Cup standings table";

/**
 * `parseStandings` for a run: a table unreadable as a whole costs the standings' events, as
 * one failure naming why, and never the leaderboards read after it.
 */
export function readStandings(sectionWikitext: string): StandingsParse {
  try {
    return parseStandings(sectionWikitext);
  } catch (error) {
    return {
      events: [],
      failures: [
        {
          pageTitle: STANDINGS_TABLE,
          basis: "standings",
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
