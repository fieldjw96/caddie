// Best-effort extraction of a tournament's Course, as named on its own Wikipedia article
// rather than the season schedule table (which only ever gives a state or country). This
// Ticket stores the name as written and nothing more: par, yardage and every other Course
// detail, and matching this name to a `courses` row, are a later Ticket's job. A tournament
// article with no infobox, or no `course` field, yields `null` rather than failing the run —
// this is enrichment, not the shape the Zod schemas above hold the line on.

const COURSE_FIELD = /\|[ \t]*course[ \t]*=[ \t]*([^\n]*)/i;

function stripWikiMarkup(value: string): string {
  return (
    value
      .replace(/<!--[\s\S]*?-->/g, "")
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

/** The `course` field of a tournament article's `{{Infobox golf tournament}}`, as written. */
export function extractCourseName(articleWikitext: string): string | null {
  const match = COURSE_FIELD.exec(articleWikitext);
  if (!match) return null;
  const stripped = stripWikiMarkup(match[1]!);
  return stripped === "" ? null : stripped;
}
