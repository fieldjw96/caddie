/**
 * Turns a Wikidata SPARQL response for scripts/queries/players.rq into `players` rows, and
 * nothing else: no fetching, no database access, so it can be tested without either. The
 * response crosses `sparqlResponseSchema` at the boundary per CLAUDE.md's "external data is
 * hostile" rule, before any of this code trusts its shape.
 *
 * A player can carry more than one P27 (country) statement, or a duplicated P569 (date of
 * birth) or P2031 (turned professional), which the flat query turns into more than one row per
 * player. `toPlayerRows` groups those back into one row and resolves the optional fields
 * deterministically - the earliest date, the earliest year, the alphabetically first country -
 * so re-running the ingest against an unchanged Wikidata never changes which value wins.
 */

import { z } from "zod";

const sparqlValue = z.object({
  type: z.string(),
  value: z.string(),
});

const sparqlBinding = z.object({
  player: sparqlValue,
  playerLabel: sparqlValue,
  countryLabel: sparqlValue.optional(),
  dob: sparqlValue.optional(),
  turnedPro: sparqlValue.optional(),
});

export const sparqlResponseSchema = z.object({
  results: z.object({
    bindings: z.array(sparqlBinding),
  }),
});

export type SparqlResponse = z.infer<typeof sparqlResponseSchema>;
type SparqlBinding = z.infer<typeof sparqlBinding>;

export interface WikidataPlayerRow {
  wikidataId: string;
  name: string;
  country: string | null;
  dateOfBirth: string | null;
  turnedProfessionalYear: number | null;
  /** The Wikidata entity URI, stored as `source_url` per the Source rule. */
  sourceUrl: string;
}

const ENTITY_URI = /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9][0-9]*)$/;

function extractQid(entityUri: string): string {
  const match = ENTITY_URI.exec(entityUri);
  if (!match?.[1]) {
    throw new Error(`Wikidata entity URI does not name an item: ${entityUri}`);
  }
  return match[1];
}

/** An xsd:dateTime like `1975-12-30T00:00:00Z` to the plain date the schema stores. */
function extractDate(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  return match?.[1] ?? null;
}

/** P2031's precision is a year: `1996-01-01T00:00:00Z` for "turned professional in 1996". */
function extractYear(value: string): number | null {
  const match = /^(\d{4})-/.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}

export function toPlayerRows(response: SparqlResponse): WikidataPlayerRow[] {
  const byPlayer = new Map<string, SparqlBinding[]>();
  for (const binding of response.results.bindings) {
    const uri = binding.player.value;
    const group = byPlayer.get(uri);
    if (group) group.push(binding);
    else byPlayer.set(uri, [binding]);
  }

  const rows: WikidataPlayerRow[] = [];
  for (const [uri, bindings] of byPlayer) {
    const first = bindings[0];
    if (!first) continue;

    const countries = bindings
      .map((b) => b.countryLabel?.value)
      .filter((v) => v !== undefined)
      .sort();
    const dates = bindings
      .map((b) => (b.dob ? extractDate(b.dob.value) : null))
      .filter((v) => v !== null)
      .sort();
    const years = bindings
      .map((b) => (b.turnedPro ? extractYear(b.turnedPro.value) : null))
      .filter((v) => v !== null)
      .sort((a, b) => a - b);

    rows.push({
      wikidataId: extractQid(uri),
      name: first.playerLabel.value,
      country: countries[0] ?? null,
      dateOfBirth: dates[0] ?? null,
      turnedProfessionalYear: years[0] ?? null,
      sourceUrl: uri,
    });
  }
  return rows;
}
