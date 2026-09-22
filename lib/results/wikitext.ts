// The small amount of wikitable reading both results parsers share. Deliberately literal: a
// table that has changed shape should fail in the parser that expected the old one, not be
// coaxed into a new reading here.

/** A table's rows, split on `|-`, each still raw wikitext. The header line and `|}` dropped. */
export function tableRows(tableWikitext: string): string[] {
  return tableWikitext
    .replace(/^\{\|[^\n]*\n/, "")
    .replace(/\n\|\}\s*$/, "")
    .split(/\n\|-[^\n]*(?:\n|$)/)
    .map((row) => row.trim())
    .filter((row) => row !== "");
}

/** Every `{| ... |}` table in some wikitext, outermost only, in order. */
export function tables(wikitext: string): string[] {
  return [...wikitext.matchAll(/(?:^|\n)(\{\|[\s\S]*?\n\|\})/g)].map((match) => match[1]!);
}

/**
 * A row's cells, in order. `||` and `!!` are inline syntax for two cells on one line, so they
 * are normalised to a line break first and every cell starts its own line. A cell's attributes
 * (`rowspan=2 align=center|T5`) are split off into `attributes`, found as the text before the
 * first `|` that is not inside a `[[link]]` or a `{{template}}`.
 */
export function rowCells(rowWikitext: string): { attributes: string; value: string }[] {
  return rowWikitext
    .replace(/\|\||!!/g, "\n|")
    .split("\n")
    .filter((line) => line.startsWith("|") || line.startsWith("!"))
    .map((line) => splitAttributes(line.slice(1)));
}

function splitAttributes(cell: string): { attributes: string; value: string } {
  let depth = 0;
  for (let i = 0; i < cell.length; i++) {
    const pair = cell.slice(i, i + 2);
    if (pair === "[[" || pair === "{{") {
      depth++;
      i++;
    } else if (pair === "]]" || pair === "}}") {
      depth--;
      i++;
    } else if (cell[i] === "|" && depth === 0) {
      return { attributes: cell.slice(0, i).trim(), value: cell.slice(i + 1).trim() };
    }
  }
  return { attributes: "", value: cell.trim() };
}

/** The first `[[Target|Label]]` in some wikitext, or null if it has none. */
export function firstWikilink(wikitext: string): { target: string; label: string } | null {
  const match = /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/.exec(wikitext);
  if (!match) return null;
  const target = match[1]!.trim();
  return { target, label: (match[2] ?? target).trim() };
}
