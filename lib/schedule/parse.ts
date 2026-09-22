// Turns the wikitext of a PGA Tour season article's Schedule section into typed rows. Every
// field that reaches a caller has crossed the Zod schemas below; a table that has changed
// shape throws, naming the row and the field, rather than handing back an incomplete row. See
// CLAUDE.md: "external data is hostile."

import { z } from "zod";

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

const EXPECTED_COLUMNS = 8;

/** One row of the official schedule table, its cells still raw wikitext. */
interface RawRow {
  cells: string[];
}

/** One row parsed into what this Ticket needs, before the canceled ones are dropped. */
export interface ScheduleRow {
  name: string;
  /** The wikilink target of the tournament's own article, for looking up its Course. */
  pageTitle: string;
  startDate: string;
  endDate: string;
  canceled: boolean;
}

/**
 * The official Schedule table's wikitext, cut from the section wikitext before any nested
 * subsection (Wikipedia nests "Unofficial events" under "Schedule" as a `===` subsection, and
 * MediaWiki's section API returns both together).
 */
export function isolateOfficialScheduleTable(sectionWikitext: string): string {
  const beforeSubsections = sectionWikitext.split(/\n===/)[0]!;
  const table = /\{\|[\s\S]*?\n\|\}/.exec(beforeSubsections)?.[0];
  if (!table) {
    throw new Error(
      'The Schedule section has no wikitable ("{|" ... "|}"). Its wikitext no longer matches the shape this ingest expects.',
    );
  }
  return table;
}

function splitTableRows(tableWikitext: string): string[] {
  const withoutHeaderLine = tableWikitext.replace(/^\{\|[^\n]*\n/, "");
  const withoutClose = withoutHeaderLine.replace(/\n\|\}\s*$/, "");
  const firstRow = withoutClose.indexOf("\n|-");
  if (firstRow === -1) {
    throw new Error('The Schedule table has no row marker ("|-"). Its wikitext has no rows.');
  }
  return withoutClose
    .slice(firstRow)
    .split(/\n\|-[^\n]*\n/)
    .map((row) => row.trim())
    .filter((row) => row !== "");
}

function splitRowCells(rowWikitext: string): string[] {
  // "||" is inline MediaWiki syntax for two cells on one line; normalising it to a line break
  // first means every cell, however it was written, starts its own line.
  return rowWikitext
    .replace(/\|\|/g, "\n|")
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.slice(1).trim());
}

function parseRawRows(tableWikitext: string): RawRow[] {
  return splitTableRows(tableWikitext).map((row) => ({ cells: splitRowCells(row) }));
}

const rowShapeSchema = z
  .array(z.string())
  .length(
    EXPECTED_COLUMNS,
    `expected ${EXPECTED_COLUMNS} columns (Date, Tournament, Location, Purse, Winner(s), OWGR points, Other tours, Notes)`,
  );

function stripWikiMarkup(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/'''?/g, "");
}

const dateCellSchema = z
  .string()
  .transform((cell) => stripWikiMarkup(cell.replace(/<\/?s>/g, "")).trim())
  .pipe(z.string().regex(/^[A-Z][a-z]{2} \d{1,2}$/, 'the "Date" cell did not match "Mon D"'));

const tournamentCellSchema = z
  .string()
  .transform((cell) => stripWikiMarkup(cell).trim())
  .pipe(
    z
      .string()
      .regex(
        /^\[\[[^|\]]+(?:\|[^\]]+)?\]\]$/,
        'the "Tournament" cell was not a single wikilink',
      ),
  );

const WIKILINK = /^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/;

function parseWikilink(cell: string): { target: string; display: string } {
  const match = WIKILINK.exec(cell);
  if (!match) {
    throw new Error(`the "Tournament" cell "${cell}" was not a single wikilink`);
  }
  const target = match[1]!.trim();
  return { target, display: (match[2] ?? target).trim() };
}

function parseDate(cell: string, season: number): string {
  const [month, day] = cell.split(" ");
  const monthNumber = MONTHS[month!];
  if (!monthNumber) {
    throw new Error(`the "Date" cell "${cell}" names an unrecognised month`);
  }
  return `${season}-${monthNumber}-${day!.padStart(2, "0")}`;
}

/** A standard PGA Tour tournament is played Thursday through Sunday, four days inclusive. */
function endDateFromStart(startDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 3);
  return start.toISOString().slice(0, 10);
}

/**
 * The official schedule, one row per tournament including the canceled ones — a caller that
 * wants to write `tournaments` rows should drop `canceled` rows itself, after counting them,
 * because a schedule that silently lost a row is exactly the failure this Ticket exists to
 * catch loudly instead.
 */
export function parseSchedule(sectionWikitext: string, season: number): ScheduleRow[] {
  const table = isolateOfficialScheduleTable(sectionWikitext);
  const rawRows = parseRawRows(table);

  return rawRows.map((row, index) => {
    const shapeResult = rowShapeSchema.safeParse(row.cells);
    if (!shapeResult.success) {
      throw new Error(
        `Schedule row ${index + 1} (${JSON.stringify(row.cells)}): ${shapeResult.error.issues[0]?.message}`,
      );
    }
    const [dateCell, tournamentCell] = shapeResult.data;

    const canceled =
      /<\/?s>/i.test(row.cells[0] ?? "") || /Canceled/i.test(row.cells[4] ?? "");

    const dateResult = dateCellSchema.safeParse(dateCell);
    if (!dateResult.success) {
      throw new Error(`Schedule row ${index + 1}: ${dateResult.error.issues[0]?.message}`);
    }
    const tournamentResult = tournamentCellSchema.safeParse(tournamentCell);
    if (!tournamentResult.success) {
      throw new Error(
        `Schedule row ${index + 1}: ${tournamentResult.error.issues[0]?.message}`,
      );
    }

    const { target, display } = parseWikilink(tournamentResult.data);
    const startDate = parseDate(dateResult.data, season);

    return {
      name: display,
      pageTitle: target,
      startDate,
      endDate: endDateFromStart(startDate),
      canceled,
    };
  });
}
