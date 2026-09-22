/**
 * Ingests the PGA Tour player roster from Wikidata (CC0). Runs scripts/queries/players.rq
 * against the public SPARQL endpoint, crosses the response through
 * lib/wikidata-players.ts's Zod schema, and upserts one `players` row per golfer keyed on
 * their Wikidata id - so re-running this leaves the same number of rows rather than
 * duplicating them, per the unique index in db/schema.ts.
 *
 * docs/adr/0002 recorded 1,592 players with 99% date-of-birth coverage on 2026-09-21. A run
 * returning far fewer means the query broke, not that the roster actually shrank, so this
 * refuses to ingest and exits non-zero instead of quietly writing a thin roster.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { client, db } from "../db/migration-client";
import { players } from "../db/schema";
import { sparqlResponseSchema, toPlayerRows } from "../lib/wikidata-players";

const ENDPOINT = "https://query.wikidata.org/sparql";
const QUERY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "queries/players.rq",
);
// Wikimedia requires a descriptive User-Agent naming the tool and a contact:
// https://meta.wikimedia.org/wiki/User-Agent_policy
const USER_AGENT =
  "caddie-ingest-players/0.1 (https://github.com/fieldjw96/caddie; contact fieldjw@outlook.com)";
const MINIMUM_PLAYERS = 1000;
const BATCH_SIZE = 500;
const RETRY_DELAY_MS = 5000;

async function runQuery(query: string): Promise<unknown> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  const request = () =>
    fetch(url, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    });

  let response = await request();
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await request();
  }
  if (!response.ok) {
    throw new Error(`Wikidata query failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main(): Promise<void> {
  const query = readFileSync(QUERY_PATH, "utf-8");
  const raw = await runQuery(query);
  const rows = toPlayerRows(sparqlResponseSchema.parse(raw));

  if (rows.length < MINIMUM_PLAYERS) {
    console.error(
      `Wikidata returned ${rows.length} players, fewer than the ${MINIMUM_PLAYERS} floor. ` +
        "That means the query broke rather than the roster actually shrinking. Refusing to ingest.",
    );
    process.exitCode = 1;
    return;
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row) => ({
      wikidataId: row.wikidataId,
      name: row.name,
      country: row.country,
      dateOfBirth: row.dateOfBirth,
      turnedProfessionalYear: row.turnedProfessionalYear,
      source: "wikidata" as const,
      sourceUrl: row.sourceUrl,
    }));

    await db
      .insert(players)
      .values(batch)
      .onConflictDoUpdate({
        target: players.wikidataId,
        set: {
          name: sql`excluded.name`,
          country: sql`excluded.country`,
          dateOfBirth: sql`excluded.date_of_birth`,
          turnedProfessionalYear: sql`excluded.turned_professional_year`,
          sourceUrl: sql`excluded.source_url`,
        },
      });
  }

  const share = (n: number) => `${n} (${((n / rows.length) * 100).toFixed(1)}%)`;
  console.log(`Ingested ${rows.length} players from Wikidata.`);
  console.log(`  country: ${share(rows.filter((r) => r.country !== null).length)}`);
  console.log(`  date of birth: ${share(rows.filter((r) => r.dateOfBirth !== null).length)}`);
  console.log(
    `  year turned professional: ` +
      share(rows.filter((r) => r.turnedProfessionalYear !== null).length),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void client.end();
  });
