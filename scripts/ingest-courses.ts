// `npm run ingest:courses` matches every Tournament in the current season's schedule to its
// Course on OpenGolfAPI, fetches each matched course into `courses`, and sets each
// Tournament's `course_id` and `course_match`. Needs `ingest:schedule` first: the Course names
// and Locations it matches are the ones that stored.
//
// A match is by name, within the Tournament's state where it has one, and only when it is
// certain; anything less is left null and listed at the end, with the name as the schedule
// wrote it. See lib/courses/match.ts for the rules.
//
// Nothing is written until every request has been made. A run that would need more requests
// than OpenGolfAPI has left today stops, says how far it got, writes nothing and exits
// non-zero. Idempotent: a re-run upserts the same courses and sets the same matches.

import { and, count, eq, inArray, isNotNull, max } from "drizzle-orm";
import { client, db } from "../db/migration-client";
import { courses, tournaments } from "../db/schema";
import { OpenGolfApiClient } from "../lib/opengolfapi/client";
import {
  planCourses,
  RunStopped,
  type CoursePlan,
  type TournamentOutcome,
} from "../lib/opengolfapi/ingest";
import { storePlan } from "../lib/opengolfapi/store";

function listUnmatched(title: string, outcomes: TournamentOutcome[]) {
  if (outcomes.length === 0) return;
  console.log(`\n${title} (${outcomes.length}):`);
  for (const { tournament, resolution } of outcomes) {
    if (resolution.status === "matched") continue;
    console.log(`  ${tournament.name}: "${resolution.scheduleName ?? "(no Course named)"}"`);
    console.log(`    ${resolution.reason}`);
    if (resolution.status === "near-miss" && resolution.candidates.length > 0) {
      console.log(`    search returned: ${resolution.candidates.join(", ")}`);
    }
  }
}

async function main() {
  const api = new OpenGolfApiClient();

  try {
    const [latest] = await db.select({ season: max(tournaments.season) }).from(tournaments);
    const season = latest?.season;
    if (season == null) {
      console.error("No Tournaments are stored. Run `npm run ingest:schedule` first.");
      process.exitCode = 1;
      return;
    }
    const scheduled = await db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        courseName: tournaments.courseName,
        location: tournaments.location,
      })
      .from(tournaments)
      .where(eq(tournaments.season, season))
      .orderBy(tournaments.startDate, tournaments.name);
    const named = scheduled.filter((t) => t.courseName !== null).length;
    console.log(
      `Matching the ${season} season: ${scheduled.length} Tournaments, ${named} with a Course name.`,
    );

    let plan: CoursePlan;
    try {
      plan = await planCourses(api, scheduled);
    } catch (error) {
      if (!(error instanceof RunStopped)) throw error;
      console.error(error.message);
      console.error(`${api.requestsSent} requests sent. Nothing was written.`);
      process.exitCode = 1;
      return;
    }
    await storePlan(db, plan);

    const matched = plan.outcomes.filter((o) => o.resolution.status === "matched");
    console.log(`\nMatched (${matched.length}):`);
    for (const { tournament, resolution } of matched) {
      if (resolution.status !== "matched") continue;
      const dropped = resolution.qualifierDropped
        ? ` (dropped "${resolution.qualifierDropped}")`
        : "";
      console.log(
        `  ${tournament.name}: "${resolution.scheduleName}" -> ` +
          `"${resolution.openGolfApiName}" [${resolution.confidence}]${dropped}`,
      );
    }
    listUnmatched(
      "Near-misses, left unmatched",
      plan.outcomes.filter((o) => o.resolution.status === "near-miss"),
    );
    listUnmatched(
      "Failed, left unmatched",
      plan.outcomes.filter((o) => o.resolution.status === "failed"),
    );

    console.log("\nCourses fetched:");
    for (const row of plan.rows) {
      const verdict =
        row.holesTrusted == null
          ? "holes not checked"
          : `holes_trusted=${row.holesTrusted}: ${row.holesCheckedTee} holes sum ` +
            `${row.holesYardageSum} against ${row.publishedYardage} published`;
      console.log(`  ${row.name}: ${verdict}`);
    }
    const untrusted = plan.rows.filter((r) => r.holesTrusted === false).length;
    const unchecked = plan.rows.filter((r) => r.holesTrusted == null).length;

    const [linked] = await db
      .select({ n: count() })
      .from(tournaments)
      .where(and(eq(tournaments.season, season), isNotNull(tournaments.courseId)));
    const ids = plan.rows.map((r) => r.openGolfApiId!);
    const [stored] =
      ids.length === 0
        ? [{ n: 0 }]
        : await db
            .select({ n: count() })
            .from(courses)
            .where(inArray(courses.openGolfApiId, ids));

    console.log(
      `\n${linked?.n ?? 0} of ${scheduled.length} ${season} Tournaments have a course_id ` +
        `(${named} named a Course). ${stored?.n ?? 0} Courses stored for them: ` +
        `${untrusted} with untrusted holes, ${unchecked} whose holes could not be checked.`,
    );
    console.log(`${api.requestsSent} OpenGolfAPI requests sent.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
