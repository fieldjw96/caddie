// The one place this repo calls the MediaWiki API. Wikimedia's User-Agent policy asks for a
// descriptive identifier and a way to reach the operator
// (https://meta.wikimedia.org/wiki/User-Agent_policy); a URL to this public repo satisfies
// that without putting a personal contact in a header sent to an external service. Every
// caller is throttled to no more than one request a second, module-wide, because that limit
// is about the process's request rate, not any one caller's.

import { z } from "zod";
import { decodeHtmlEntities } from "./html-entities";

const USER_AGENT = "Caddie/0.1 (+https://github.com/fieldjw96/caddie) wikipedia-ingest";

const API_ENDPOINT = "https://en.wikipedia.org/w/api.php";

const MIN_INTERVAL_MS = 1000;

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

async function callApi(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API_ENDPOINT);
  url.search = new URLSearchParams({
    ...params,
    format: "json",
    formatversion: "2",
  }).toString();

  await throttle();
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`MediaWiki API request to ${url} failed: HTTP ${response.status}`);
  }
  return response.json();
}

const mediaWikiErrorSchema = z.object({
  error: z.object({ code: z.string(), info: z.string() }),
});

const parseWikitextResponseSchema = z.object({
  parse: z.object({
    title: z.string(),
    revid: z.number().int().positive(),
    // Decoded once, here, so every caller of fetchArticle/fetchSection/fetchIntro reads plain
    // text rather than markup: this is the one place this repo takes wikitext from a MediaWiki
    // response.
    wikitext: z.string().transform(decodeHtmlEntities),
  }),
});

const parseSectionsResponseSchema = z.object({
  parse: z.object({
    title: z.string(),
    sections: z.array(
      z.object({
        index: z.string(),
        line: z.string(),
        toclevel: z.number().int(),
      }),
    ),
  }),
});

/** A Wikipedia article's wikitext, the revision it was read at, and its resolved title. */
export interface WikitextArticle {
  title: string;
  revid: number;
  wikitext: string;
}

/**
 * The article asked for does not exist. Its own type because a caller reading a season in
 * progress expects some of these, for events nobody has written up yet, and must tell them
 * apart from a request that failed.
 */
export class MissingArticleError extends Error {
  constructor(readonly page: string) {
    super(`Wikipedia has no article titled "${page}".`);
    this.name = "MissingArticleError";
  }
}

function throwIfMediaWikiError(payload: unknown, context: string, page?: string): void {
  const asError = mediaWikiErrorSchema.safeParse(payload);
  if (asError.success && page !== undefined && asError.data.error.code === "missingtitle") {
    throw new MissingArticleError(page);
  }
  if (asError.success) {
    throw new Error(
      `MediaWiki API refused ${context}: ${asError.data.error.code} — ${asError.data.error.info}`,
    );
  }
}

/** The wikitext of a whole article, following redirects. */
export async function fetchArticle(page: string): Promise<WikitextArticle> {
  const payload = await callApi({
    action: "parse",
    page,
    redirects: "1",
    prop: "wikitext|revid",
  });
  throwIfMediaWikiError(payload, `parse of "${page}"`, page);
  const parsed = parseWikitextResponseSchema.parse(payload);
  return parsed.parse;
}

/**
 * The wikitext of a single named section (matched by heading text, case-sensitive) of an
 * article, plus the revision it was read at. Wikipedia's section API returns everything up to
 * the next sibling heading at the same level, so a section with subsections still needs its
 * caller to know where the part it wants ends.
 */
export async function fetchSection(page: string, heading: string): Promise<WikitextArticle> {
  const sectionsPayload = await callApi({
    action: "parse",
    page,
    redirects: "1",
    prop: "sections",
  });
  throwIfMediaWikiError(sectionsPayload, `section list of "${page}"`);
  const sections = parseSectionsResponseSchema.parse(sectionsPayload).parse.sections;
  const section = sections.find((s) => s.line === heading);
  if (!section) {
    throw new Error(
      `"${page}" has no "${heading}" section. Its sections are: ${sections.map((s) => s.line).join(", ")}`,
    );
  }

  const payload = await callApi({
    action: "parse",
    page,
    redirects: "1",
    prop: "wikitext|revid",
    section: section.index,
  });
  throwIfMediaWikiError(payload, `section "${heading}" of "${page}"`);
  const parsed = parseWikitextResponseSchema.parse(payload);
  return parsed.parse;
}

/**
 * The wikitext of a page's lead section (MediaWiki's section 0), where `{{Infobox golf
 * season}}` lives. No section lookup needed: section 0 always exists and is always the lead.
 */
export async function fetchIntro(page: string): Promise<WikitextArticle> {
  const payload = await callApi({
    action: "parse",
    page,
    redirects: "1",
    prop: "wikitext|revid",
    section: "0",
  });
  throwIfMediaWikiError(payload, `intro of "${page}"`);
  const parsed = parseWikitextResponseSchema.parse(payload);
  return parsed.parse;
}

/** The permanent link to the exact revision an article was read at, not just the article. */
export function revisionUrl(title: string, revid: number): string {
  return `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replaceAll(" ", "_"))}&oldid=${revid}`;
}
