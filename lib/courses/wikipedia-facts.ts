// Reads altitude and green surface off a Course's own Wikipedia article. Pure: given the
// article's wikitext, it returns what it found, or null for a fact that article does not
// state. No fetch, no database, so every case is testable from a wikitext fixture. Fetching
// the article is lib/courses/wikipedia-ingest.ts's job.
//
// Both facts live in `{{Infobox golf facility}}`, the template real PGA Tour venue articles
// carry, as a `| field = value` line. Neither field is reliably filled in: many articles leave
// it blank, or comment it out outright (`<!-- {{convert|30|ft}} -->`), which this module treats
// exactly as if the field were absent, because a commented-out value is one nobody has
// confirmed. That is expected, not a bug: this is prose-adjacent data, and most courses will
// come back with one or both facts missing.
//
// Altitude is stored in feet, because that is the unit the golf-commentary claim this Ticket
// exists to support is stated in (a ball flies roughly 10% further at 5,000 feet). Wikipedia
// gives elevation as feet, as metres, or as both via `{{convert|N|ft|m}}` / `{{convert|N|m|ft}}`
// / `{{cvt|...}}`, in either order, and occasionally as a range ("{{cvt|160|-|310|ft}}") when a
// course's site itself has real relief; a range is read as its midpoint. A metric reading is
// converted at 1 m = 3.28084 ft and rounded to the nearest foot.

const METRES_TO_FEET = 3.28084;

function stripMarkup(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\[[^|\]]*\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * The raw value of an infobox `| field = ...` line, before markup is stripped: a caller that
 * still needs to see a `{{convert}}` template reads this, rather than `infoboxField`.
 */
function infoboxRawValue(wikitext: string, field: string): string | null {
  const match = new RegExp(`\\|[ \\t]*${field}[ \\t]*=([^\\n]*)`, "i").exec(wikitext);
  return match ? match[1]! : null;
}

/** An infobox field's value with wiki markup stripped, or null if absent or blank. */
function infoboxField(wikitext: string, field: string): string | null {
  const raw = infoboxRawValue(wikitext, field);
  if (raw === null) return null;
  const cleaned = stripMarkup(raw);
  return cleaned === "" ? null : cleaned;
}

function parseNumber(text: string): number | null {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// A range is written as its own pair of parameters ("{{cvt|160|–|310|ft}}"), not a dash
// touching the first number, so the optional group matches the whole "|–|second-number" span.
const CONVERT_TEMPLATE =
  /\{\{\s*(?:convert|cvt)\s*\|\s*([\d,.]+)\s*(?:\|\s*[-–—]\s*\|\s*([\d,.]+)\s*)?\|\s*(ft|feet|m|metres|meters)\b/i;

/** The number a `{{convert}}`/`{{cvt}}` template gives, in feet, midpoint of a range if given. */
function feetFromConvertTemplate(text: string): number | null {
  const match = CONVERT_TEMPLATE.exec(text);
  if (!match) return null;
  const low = parseNumber(match[1]!);
  const high = match[2] ? parseNumber(match[2]) : null;
  if (low === null) return null;
  const value = high === null ? low : (low + high) / 2;
  const unit = match[3]!.toLowerCase();
  return unit.startsWith("f") ? Math.round(value) : Math.round(value * METRES_TO_FEET);
}

/** The number a plain "400 ft" / "400 feet" / "122 m" / "122 metres" reads, in feet. */
function feetFromPlainText(text: string): number | null {
  const feet = /([\d,.]+)\s*(?:ft|feet)\b/i.exec(text);
  if (feet) {
    const n = parseNumber(feet[1]!);
    return n === null ? null : Math.round(n);
  }
  const metres = /([\d,.]+)\s*(?:m|metres|meters)\b/i.exec(text);
  if (metres) {
    const n = parseNumber(metres[1]!);
    return n === null ? null : Math.round(n * METRES_TO_FEET);
  }
  return null;
}

/** The Course's altitude in feet, from its article's `elevation` infobox field. */
export function parseAltitudeFeet(wikitext: string): number | null {
  const raw = infoboxRawValue(wikitext, "elevation");
  if (raw === null) return null;
  const cleaned = stripMarkup(raw);
  if (cleaned === "") return null;
  return feetFromConvertTemplate(cleaned) ?? feetFromPlainText(cleaned);
}

/** The Course's green surface, verbatim, from its article's `greens` infobox field. */
export function parseGreenSurface(wikitext: string): string | null {
  return infoboxField(wikitext, "greens");
}

export interface CourseWikipediaFacts {
  altitudeFeet: number | null;
  greenSurface: string | null;
}

/** Both facts this Ticket reads, from one article's wikitext. */
export function extractCourseFacts(wikitext: string): CourseWikipediaFacts {
  return { altitudeFeet: parseAltitudeFeet(wikitext), greenSurface: parseGreenSurface(wikitext) };
}
