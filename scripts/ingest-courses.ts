// `npm run ingest:courses` fetches course facts from OpenGolfAPI into `courses`.
//
//   npm run ingest:courses                      the eight VENUES in lib/opengolfapi/ingest.ts
//   npm run ingest:courses -- "Pebble Beach"    only the VENUES whose query or name this is
//
// Idempotent: a course is keyed on its OpenGolfAPI id, so a re-run updates the same rows
// rather than adding any. One course that fails, by changed shape or failed resolution, is
// reported and skipped; the run carries on, then exits non-zero so the failure is not missed.
// Running out of daily requests ends the run, because every later request would fail too.

import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { courses } from "../db/schema";
import { OpenGolfApiClient, RateLimitExhausted } from "../lib/opengolfapi/client";
import { fetchCourse, VENUES, type Venue } from "../lib/opengolfapi/ingest";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

function selected(args: string[]): Venue[] {
  if (args.length === 0) return VENUES;
  const is = (v: Venue, arg: string) =>
    [v.query, v.name].some((n) => n.toLowerCase() === arg.toLowerCase());
  const unknown = args.filter((a) => !VENUES.some((v) => is(v, a)));
  if (unknown.length > 0) {
    throw new Error(`Not a known venue: ${unknown.join(", ")}. Add it to VENUES first.`);
  }
  return VENUES.filter((v) => args.some((a) => is(v, a)));
}

async function main() {
  const venues = selected(process.argv.slice(2));
  const client = postgres(url!, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  const api = new OpenGolfApiClient();
  const failed: string[] = [];

  try {
    for (const venue of venues) {
      try {
        const row = await fetchCourse(api, venue);
        await db
          .insert(courses)
          .values(row)
          .onConflictDoUpdate({
            target: courses.openGolfApiId,
            set: { ...row, recordedAt: sql`now()` },
          });

        const verdict =
          row.holesTrusted === null || row.holesTrusted === undefined
            ? "holes not checked"
            : `holes_trusted=${row.holesTrusted}: ${row.holesCheckedTee} holes sum ` +
              `${row.holesYardageSum} against ${row.publishedYardage} published ` +
              `(${(row.holesYardageDifference ?? 0) >= 0 ? "+" : ""}${row.holesYardageDifference})`;
        console.log(`ok    ${venue.query} -> ${row.name}: ${verdict}`);
      } catch (error) {
        if (error instanceof RateLimitExhausted) throw error;
        failed.push(venue.query);
        console.error(`FAIL  ${venue.query}: ${error instanceof Error ? error.message : error}`);
      }
    }
  } finally {
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(courses)
      .where(eq(courses.source, "opengolfapi"));
    console.log(
      `${api.requestsSent} requests sent. ${count?.n ?? 0} OpenGolfAPI courses stored.`,
    );
    await client.end();
  }

  if (failed.length > 0) {
    console.error(`${failed.length} of ${venues.length} failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
