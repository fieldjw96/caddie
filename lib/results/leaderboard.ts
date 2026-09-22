// An event article's own final leaderboard: every Player who teed off, their finish, and
// their round-by-round scores. Wikipedia carries one for the majors and the Players and
// nothing for a regular tour event, which is the gap ADR 0002 says the site must show.
//
// The table read is the one under "Final leaderboard" where the article has that heading,
// and under "Final round" where it does not (the Masters puts it straight under "Final
// round", with the Players below the top 10 in a second, collapsed table). Either way the
// section ends at the next heading, which keeps "Scorecard" and a playoff table out of it.

import { z } from "zod";
import { finishSchema, stripCellMarkup } from "./finish";
import { withoutDisambiguator } from "./names";
import type { ParsedEntry, Rounds } from "./types";
import { firstWikilink, rowCells, tableRows, tables } from "./wikitext";

/** A full-field leaderboard with fewer lines than this is a table this parser misread. */
const MINIMUM_ENTRIES = 30;

const ROUNDS = 4;

/**
 * A score cell: `72-66-66-73=277` for four rounds, `74-73=147` for a missed cut, `72` for a
 * withdrawal after one round. Some articles use an en dash. The total, where printed, is
 * checked against the rounds, and a round never printed is null, not a guess.
 */
const roundsSchema = z
  .string()
  .transform(stripCellMarkup)
  .pipe(
    z
      .string()
      .regex(
        /^[0-9]{2,3}(?:\s*[-–]\s*[0-9]{2,3}){0,3}(?:\s*=\s*[0-9]{2,3})?$/,
        'expected round scores ("72-66-66-73=277", "74-73=147", "72")',
      ),
  )
  .transform((cell, context): Rounds => {
    const [strokes, total] = cell.split("=").map((part) => part.trim());
    const rounds = strokes!.split(/[-–]/).map((round) => Number(round.trim()));
    if (total !== undefined) {
      const sum = rounds.reduce((a, b) => a + b, 0);
      if (sum !== Number(total)) {
        context.addIssue({
          code: "custom",
          message: `the rounds sum to ${sum} but the total printed is ${total}`,
        });
        return z.NEVER;
      }
    }
    const padded: (number | null)[] = [...rounds];
    while (padded.length < ROUNDS) padded.push(null);
    return padded as Rounds;
  });

const leaderboardRowSchema = z.object({
  place: finishSchema,
  player: z.object({
    name: z.string().min(1, "the Player cell has no name"),
    candidates: z.array(z.string().min(1)).min(1),
  }),
  score: roundsSchema,
});

const HEADING = /^(=+)\s*(.+?)\s*\1\s*$/gm;

/** The wikitext under the first heading named `name`, up to the next heading of any level. */
function sectionUnder(articleWikitext: string, name: string): string | null {
  const headings = [...articleWikitext.matchAll(HEADING)];
  const index = headings.findIndex((h) => h[2]!.toLowerCase() === name.toLowerCase());
  if (index === -1) return null;
  const start = headings[index]!.index! + headings[index]![0].length;
  const end = headings[index + 1]?.index ?? articleWikitext.length;
  return articleWikitext.slice(start, end);
}

function parsePlayerCell(cell: string): { name: string; candidates: string[] } {
  const withoutFlag = cell.replace(/\{\{\s*flagicon[^}]*\}\}/gi, "");
  const link = firstWikilink(withoutFlag);
  if (link) {
    const target = withoutDisambiguator(link.target);
    const label = stripCellMarkup(link.label);
    return { name: label, candidates: [...new Set([target, label])] };
  }
  // An unlinked name, with its `(a)` amateur or `(c)` past champion marker taken off.
  const name = stripCellMarkup(withoutFlag)
    .replace(/\s*\([a-z]\)\s*$/i, "")
    .trim();
  return { name, candidates: name === "" ? [] : [name] };
}

/**
 * An event article's final leaderboard. Throws, naming the row and the field, when the
 * article has no leaderboard where one is expected or any line of it fails its schema: a
 * leaderboard with one line misread is not a leaderboard to store part of.
 */
export function parseLeaderboard(articleWikitext: string): ParsedEntry[] {
  const section =
    sectionUnder(articleWikitext, "Final leaderboard") ??
    sectionUnder(articleWikitext, "Final round");
  if (section === null) {
    throw new Error('The article has no "Final leaderboard" or "Final round" section.');
  }

  const entries: ParsedEntry[] = [];
  const seen = new Set<string>();
  // A tie is printed as one place cell spanning several rows, so a row without a place cell
  // takes the place of the row above it.
  let place: string | null = null;

  for (const table of tables(section)) {
    for (const row of tableRows(table)) {
      const cells = rowCells(row);
      const playerIndex = cells.findIndex((cell) => /\{\{\s*flagicon/i.test(cell.value));
      // A header, a legend ("Champion", "(a) = amateur") or a caption: not a Player's line.
      if (playerIndex === -1) continue;
      if (playerIndex > 0) place = cells[0]!.value;

      const player = parsePlayerCell(cells[playerIndex]!.value);
      const label = player.name || `row ${entries.length + 1}`;
      if (place === null) {
        throw new Error(`The leaderboard's first line (${label}) has no place cell.`);
      }
      const parsed = leaderboardRowSchema.safeParse({
        place,
        player,
        score: cells[playerIndex + 1]?.value ?? "",
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `Leaderboard line ${entries.length + 1} (${label}), field "${issue?.path.join(".")}": ${issue?.message}`,
        );
      }
      if (seen.has(parsed.data.player.name)) {
        throw new Error(`The leaderboard lists ${parsed.data.player.name} twice.`);
      }
      seen.add(parsed.data.player.name);
      entries.push({
        ...parsed.data.player,
        finish: parsed.data.place,
        rounds: parsed.data.score,
      });
    }
  }

  if (entries.length < MINIMUM_ENTRIES) {
    throw new Error(
      `The leaderboard has ${entries.length} lines, fewer than the ${MINIMUM_ENTRIES} a full field has.`,
    );
  }
  return entries;
}
