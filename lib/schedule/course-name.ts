// Best-effort extraction of a tournament's Course, as named on its own Wikipedia article
// rather than the season schedule table (which only ever gives a state or country), together
// with the par and yardage the same infobox states beside it. One pass over the wikitext
// `resolveCourseFacts` already fetches, so reading three fields costs no more requests than
// reading one did. A tournament article with no infobox, or no `course` field, yields `null`
// rather than failing the run — this is enrichment, not the shape the Zod schemas in parse.ts
// hold the line on.
//
// These are the facts a Course OpenGolfAPI does not have is created from: see
// lib/courses/from-tournament.ts, which decides whether they are enough and refuses rather
// than guesses when they are not. Nothing here infers a missing value, and nothing here reads
// `holes`: an article states a total, never a card, and a hole-by-hole figure invented from a
// total would poison `holes_trusted`.

const COURSE_FIELD = /\|[ \t]*course[ \t]*=[ \t]*([^\n]*)/i;
const PAR_FIELD = /\|[ \t]*par[ \t]*=[ \t]*([^\n]*)/i;
const YARDAGE_FIELD = /\|[ \t]*yardage[ \t]*=[ \t]*([^\n]*)/i;

function stripWikiMarkup(value: string): string {
  return (
    value
      .replace(/<!--[\s\S]*?-->/g, "")
      // A footnote on a value is not part of the value. Dropped whole, contents and all,
      // because `<ref>7,315 yd<ref>` would otherwise leave its own numbers behind.
      .replace(/<ref[^>]*\/>/gi, "")
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
      .replace(/\[\[[^|\]]*\|([^\]]+)\]\]/g, "$1")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/'''?/g, "")
      .replace(/<br\s*\/?>/gi, ", ")
      // `\s` matches a non-breaking space along with the ordinary kind, so a name is what a
      // person would type: one space between words, none at either end.
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** An infobox field's value with markup stripped, or null when it is absent or blank. */
function field(articleWikitext: string, pattern: RegExp): string | null {
  const match = pattern.exec(articleWikitext);
  if (!match) return null;
  const stripped = stripWikiMarkup(match[1]!);
  return stripped === "" ? null : stripped;
}

/** The `course` field of a tournament article's `{{Infobox golf tournament}}`, as written. */
export function extractCourseName(articleWikitext: string): string | null {
  return field(articleWikitext, COURSE_FIELD);
}

/**
 * The `par` field, as a whole number of strokes. Only a bare two-digit number is read: a
 * value that says anything else ("71 (2026)", "70/71", "see below") is a value nobody can be
 * sure of, and is returned as absent rather than as a guess at what was meant. Whether 71 is a
 * par a Tour course plays is not this function's question — see `implausibleRecord`.
 */
export function extractCoursePar(articleWikitext: string): number | null {
  const value = field(articleWikitext, PAR_FIELD);
  if (value === null || !/^\d{2}$/.test(value)) return null;
  return Number(value);
}

// Wikipedia writes a yardage as a {{convert}}/{{cvt}} template, as a number with its unit, or
// as a bare number, with or without a thousands separator: "{{Convert|7315|yd}}",
// "{{convert|7,315|yd|m}}", "7,315 yards (6,689 m)", "7315". Only yards are read. A total
// given in metres is left absent rather than converted, because a metric figure in a golf
// infobox is more likely a different measurement than the published championship total this
// repo means by yardage.
const YARDAGE_CONVERT = /^\{\{\s*(?:convert|cvt)\s*\|\s*([\d,]+)\s*\|\s*yd\b/i;
const YARDAGE_IN_YARDS = /^([\d,]+)\s*(?:yd|yds|yards?)\b/i;
// A bare number is read as yards, which is the unit the field is for, and only when it stands
// alone: anything after it is something this has not been taught to read.
const YARDAGE_BARE = /^([\d,]+)$/;

/** The `yardage` field in yards, or null when the article states none this can read. */
export function extractCourseYardage(articleWikitext: string): number | null {
  const value = field(articleWikitext, YARDAGE_FIELD);
  if (value === null) return null;
  const digits = (YARDAGE_CONVERT.exec(value) ??
    YARDAGE_IN_YARDS.exec(value) ??
    YARDAGE_BARE.exec(value))?.[1];
  if (digits === undefined) return null;
  const yards = Number(digits.replace(/,/g, ""));
  return Number.isInteger(yards) ? yards : null;
}

/** What a Tournament's own article says about its venue: all three fields, or null for each. */
export interface TournamentCourseFacts {
  name: string | null;
  par: number | null;
  /** The published total in yards, as the article states it. Not a sum of holes. */
  yardage: number | null;
}

/** Every venue fact this reads, from one article's wikitext and no second fetch. */
export function extractTournamentCourse(articleWikitext: string): TournamentCourseFacts {
  return {
    name: extractCourseName(articleWikitext),
    par: extractCoursePar(articleWikitext),
    yardage: extractCourseYardage(articleWikitext),
  };
}
