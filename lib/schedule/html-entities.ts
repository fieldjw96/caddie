// Decodes the HTML entities MediaWiki's `action=parse` response can leave inside otherwise
// plain wikitext — `&nbsp;` most visibly, but also `&amp;`, dashes, and numeric references. A
// site that changes shape fails loudly elsewhere; this one fails silently, storing markup as
// if it were the fact, so every caller that reads wikitext from lib/schedule/wikipedia.ts gets
// it decoded before it ever reaches a Zod schema or a page. Not a general HTML decoder: it
// runs before any wiki markup is stripped, so it only ever sees entities.

/** MediaWiki writes a non-breaking space as markup; this repo stores it as an ordinary one. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
};

/** The code point of U+00A0, decoded the same way whether written as a name or a number. */
const NBSP_CODE_POINT = 0xa0;

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g;

function fromCodePoint(codePoint: number, match: string): string {
  if (Number.isNaN(codePoint)) return match;
  return codePoint === NBSP_CODE_POINT ? " " : String.fromCodePoint(codePoint);
}

/** Every named and numeric HTML entity in `text`, decoded to the character it names. An
 * entity this table does not recognise, named or numeric-but-invalid, is left as written. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return fromCodePoint(Number.parseInt(body.slice(2), 16), match);
    }
    if (body.startsWith("#")) {
      return fromCodePoint(Number.parseInt(body.slice(1), 10), match);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}
