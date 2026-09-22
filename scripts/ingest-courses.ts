// `npm run ingest:courses` fetches course facts from OpenGolfAPI into `courses`.
//
//   npm run ingest:courses                      the eight VENUES in lib/opengolfapi/ingest.ts
//   npm run ingest:courses -- "Pebble Beach"    only the VENUES whose query or name this is
//
// Idempotent: a course is keyed on its OpenGolfAPI id, so a re-run updates the same rows
// rather than adding any. One course that fails, by changed shape or failed resolution, is
// reported and skipped; the run carries on, then exits non-zero so the failure is not missed.
// Running out of daily requests ends the run, because every later request would fail too.

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { courses } from "../db/schema";
import { OpenGolfApiClient } from "../lib/opengolfapi/client";
import { ingestVenues, VENUES, type Outcome, type Venue } from "../lib/opengolfapi/ingest";
import { storeCourse } from "../lib/opengolfapi/store";

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

function report(outcome: Outcome) {
  if (!outcome.ok) {
    console.error(`FAIL  ${outcome.venue.query}: ${outcome.error}`);
    return;
  }
  const row = outcome.row;
  const difference = row.holesYardageDifference ?? 0;
  const verdict =
    row.holesTrusted == null
      ? "holes not checked"
      : `holes_trusted=${row.holesTrusted}: ${row.holesCheckedTee} holes sum ` +
        `${row.holesYardageSum} against ${row.publishedYardage} published ` +
        `(${difference >= 0 ? "+" : ""}${difference})`;
  console.log(`ok    ${outcome.venue.query} -> ${row.name}: ${verdict}`);
}

async function main() {
  const venues = selected(process.argv.slice(2));
  const client = postgres(url!, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  const api = new OpenGolfApiClient();

  try {
    const outcomes = await ingestVenues(api, venues, (row) => storeCourse(db, row), report);
    const failed = outcomes.filter((o) => !o.ok).map((o) => o.venue.query);
    if (failed.length > 0) {
      console.error(`${failed.length} of ${venues.length} failed: ${failed.join(", ")}`);
      process.exitCode = 1;
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
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
