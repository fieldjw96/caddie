// What production is actually doing, when the page will only say 500.
//
// Next masks a server component's exception in production behind an error digest, which is
// the correct default and was also why a completely dead site took most of a day to diagnose:
// the database was populated, the migrations applied, the right commit deployed, and every
// check green, all at once. Nothing could say why.
//
// This route answers that, and is careful about how much it says. It reports the *names* of
// the connection variables that are set and never a value, the host and port it reached and
// never the credentials, and a driver error's code and message with anything credential-shaped
// removed. That is enough to tell a missing variable from a refused connection from an empty
// table, which is the whole question, and not enough to hand anyone a way in.
//
// A healthy connection to a populated database is still not an answer: four outages in six
// weeks left the homepage with no Player rows while this route said `ok: true` throughout,
// because it only ever counted `tournaments` rows. `rankable` below asks the same question the
// page answers, the same way the page answers it, so this route cannot disagree with what a
// reader actually sees.

import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../../db/client";
import { resolveAppDatabaseUrl } from "../../../db/env";
import { checkRankable } from "../../../lib/ingest/rankable";
import { gatherRankabilityData } from "../../../lib/ingest/rankable-query";
import { matchCourse } from "../../../lib/page/data";
import { chooseRankableTournament } from "../../../lib/page/choose-tournament";
import { upcomingTournaments } from "../../../lib/schedule/next-tournament";

type Database = typeof db;

// A health check that reads a cached answer is not a health check.
export const dynamic = "force-dynamic";

/** The connection variables the app resolves, reported as set or not. Never their values. */
const CONNECTION_VARS = ["DATABASE_URL", "POSTGRES_URL"] as const;

/**
 * Strip anything shaped like a credential out of a driver message before it leaves the server.
 * postgres.js usually does not echo the URL, but "usually" is not a property to rely on when
 * the output is public.
 */
function redact(text: string): string {
  return text
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^:/@\s]+:[^@\s]+@/g, "$1***:***@")
    .replace(/(password=)[^\s&]+/gi, "$1***");
}

/** Host and port only, so a reader can tell pooled from direct without seeing the credentials. */
function endpoint(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "unparseable";
  }
}

type RankableState = "rankable" | "unrankable" | "no-next-tournament";

interface RankableSummary {
  state: RankableState;
  /** The Tournament the homepage would render right now, or null once the season has none left. */
  tournament: string | null;
  course: string | null;
  courseTraitCount: number;
  anyPlayerHasStrength: boolean;
  /** `checkRankable`'s reason the homepage's Tournament fails, or null when it does not. */
  reason: string | null;
  /** Present only when the page fell forward (#154) past this, the true next Tournament. */
  trueNextTournament?: string;
}

/**
 * Whether the Tournament the homepage would actually render can be ranked, and why not when it
 * cannot. Chooses that Tournament the same way `lib/page/load.ts`'s `loadPageData` does after
 * #154 — `upcomingTournaments` then `chooseRankableTournament` — over data
 * `gatherRankabilityData` reads once, so this can never disagree with the page.
 */
async function rankableSummary(database: Database, now: Date): Promise<RankableSummary> {
  const { schedule, courses, traitCounts, anyPlayerHasStrength } =
    await gatherRankabilityData(database);
  const upcoming = upcomingTournaments(schedule, now);
  if (upcoming.length === 0) {
    return {
      state: "no-next-tournament",
      tournament: null,
      course: null,
      courseTraitCount: 0,
      anyPlayerHasStrength,
      reason: null,
    };
  }

  const trueNext = upcoming[0]!;
  const { tournament } = chooseRankableTournament(
    upcoming,
    courses,
    traitCounts,
    anyPlayerHasStrength,
  );
  // `upcoming` is not empty, so the walk always answers with one of its Tournaments; this is
  // the type's null case, not a state reachable from here. See lib/page/load.ts.
  const next = tournament!;
  const courseId = matchCourse(next, courses)?.id ?? null;
  const courseTraitCount = courseId === null ? 0 : (traitCounts.get(courseId) ?? 0);
  const result = checkRankable({
    next: { name: next.name, courseName: next.courseName, courseId },
    courseTraitCount,
    anyPlayerHasStrength,
  });

  return {
    state: result.ok ? "rankable" : "unrankable",
    tournament: next.name,
    course: matchCourse(next, courses)?.name ?? null,
    courseTraitCount,
    anyPlayerHasStrength,
    reason: result.ok ? null : result.reason,
    ...(next.name === trueNext.name ? {} : { trueNextTournament: trueNext.name }),
  };
}

export async function GET() {
  const variables = Object.fromEntries(
    CONNECTION_VARS.map((name) => [name, process.env[name] !== undefined]),
  );

  let url: string;
  try {
    url = resolveAppDatabaseUrl();
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "resolve",
        detail: "No connection string is set in this environment.",
        variables,
        error: redact(error instanceof Error ? error.message : String(error)),
      },
      { status: 503 },
    );
  }

  try {
    const [row] = await db.execute<{ tournaments: number }>(
      sql`select count(*)::int as tournaments from tournaments`,
    );
    const rankable = await rankableSummary(db, new Date());
    return NextResponse.json({
      ok: true,
      stage: "query",
      variables,
      endpoint: endpoint(url),
      tournaments: row?.tournaments ?? 0,
      rankable,
    });
  } catch (error) {
    // The interesting case. A refused connection, a TLS failure, a pooler rejecting a
    // prepared statement and a missing table all land here and all look identical from
    // outside, so the driver's own code is the thing worth surfacing.
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : null;
    return NextResponse.json(
      {
        ok: false,
        stage: "query",
        variables,
        endpoint: endpoint(url),
        code,
        error: redact(error instanceof Error ? error.message : String(error)),
      },
      { status: 503 },
    );
  }
}
