// `npm run ingest:courses` matches every stored Tournament to its Course on OpenGolfAPI,
// fetches each matched course into `courses`, and sets each Tournament's `course_id` and
// `course_match`. Needs `ingest:schedule` first: the Course names and Locations it matches are
// the ones that stored.
//
// Every stored season, not only the current one. A venue record is a Player's results at this
// Course, so it only joins where a past Tournament points at the same `courses` row as the one
// being played: a season left unlinked takes its whole set of results out of reach of that
// column, however well the current season is matched.
//
// A match is by name, within the Tournament's state where it has one, and only when it is
// certain; anything less falls back to the Course the Tournament's own article names, and
// failing that is left null and listed at the end, with the name as the schedule wrote it. See
// lib/courses/match.ts for the rules and lib/courses/from-tournament.ts for the fallback.
//
// Nothing is written until every request has been made. A run that would need more requests
// than OpenGolfAPI has left today stops, says how far it got, writes nothing and exits
// non-zero. Idempotent: a re-run upserts the same courses and sets the same matches.

import { count, countDistinct, isNotNull, sql } from "drizzle-orm";
import { client, db } from "../db/migration-client";
import { courses, tournaments } from "../db/schema";
import {
  planArticleCourses,
  type ArticleCoursePlan,
  type KnownCourse,
} from "../lib/courses/from-tournament";
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

/** What the fallback did, Tournament by Tournament, and what it left for somebody to read. */
function reportArticleCourses(fromArticles: ArticleCoursePlan) {
  const { venues, skipped } = fromArticles;
  const played = venues.reduce((n, v) => n + v.tournaments.length, 0);
  console.log(
    `\nFrom the Tournaments' own Wikipedia articles: ${venues.length} Courses for ` +
      `${played} Tournaments OpenGolfAPI could not match, ${skipped.length} skipped.`,
  );
  for (const venue of venues) {
    const where = venue.tournaments
      .map((t) => `${t.name} (${t.startDate.slice(0, 4)})`)
      .join(", ");
    if (venue.reuse) {
      console.log(
        `  "${venue.name}" is the stored Course "${venue.reuse.name}" ` +
          `(${venue.reuse.openGolfApiId === null ? "from an article" : "from OpenGolfAPI"}), ` +
          `reused rather than stored again: ${where}`,
      );
    } else {
      const { name, par, publishedYardage, sourceUrl } = venue.row;
      console.log(
        `  Created "${name}": par ${par}, ${publishedYardage} yards, no holes. ${sourceUrl}`,
      );
      console.log(`    played by: ${where}`);
    }
  }
  if (skipped.length > 0) {
    console.log(`\nNo Course from their own article either (${skipped.length}):`);
    for (const skip of skipped) console.log(`  ${skip.tournamentName}: ${skip.reason}`);
  }
}

async function main() {
  const api = new OpenGolfApiClient();

  try {
    const scheduled = await db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        season: tournaments.season,
        startDate: tournaments.startDate,
        courseName: tournaments.courseName,
        location: tournaments.location,
        coursePar: tournaments.coursePar,
        courseYardage: tournaments.courseYardage,
        courseArticleUrl: tournaments.courseArticleUrl,
      })
      .from(tournaments)
      .orderBy(tournaments.startDate, tournaments.name);
    if (scheduled.length === 0) {
      console.error("No Tournaments are stored. Run `npm run ingest:schedule` first.");
      process.exitCode = 1;
      return;
    }
    const seasons = [...new Set(scheduled.map((t) => t.season))].sort((a, b) => a - b);
    const named = scheduled.filter((t) => t.courseName !== null).length;
    console.log(
      `Matching the ${seasons.join(", ")} season${seasons.length === 1 ? "" : "s"}: ` +
        `${scheduled.length} Tournaments, ${named} with a Course name.`,
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

    // OpenGolfAPI first, always: this is reached only for a Tournament its search could not
    // match, and it reads facts `ingest:schedule` already stored, so it costs no request.
    // Every Course this run can point such a Tournament at: the table as it stands, and the
    // rows the matches above are about to write. A match's own row wins where both hold it, so
    // the name compared is the one that will be stored, not the one that was.
    const stored = await db
      .select({
        courseId: courses.id,
        openGolfApiId: courses.openGolfApiId,
        name: courses.name,
      })
      .from(courses);
    const known = new Map<string, KnownCourse>(
      stored.map((c) => [c.openGolfApiId ?? `courses.id ${c.courseId}`, c]),
    );
    for (const row of plan.rows) {
      known.set(row.openGolfApiId!, {
        courseId: known.get(row.openGolfApiId!)?.courseId ?? null,
        openGolfApiId: row.openGolfApiId!,
        name: row.name,
      });
    }
    const fromArticles = planArticleCourses(
      scheduled,
      new Set(
        plan.outcomes
          .filter((o) => o.resolution.status === "matched")
          .map((o) => o.tournament.id),
      ),
      [...known.values()],
    );
    await storePlan(db, plan, fromArticles);

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
      "Near-misses, left to the Tournament's own article",
      plan.outcomes.filter((o) => o.resolution.status === "near-miss"),
    );
    listUnmatched(
      "Failed, left to the Tournament's own article",
      plan.outcomes.filter((o) => o.resolution.status === "failed"),
    );

    reportArticleCourses(fromArticles);

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

    // The three counts this stage is judged on, read back from the database rather than from
    // the plan: `Courses`, the Tournaments linked to one, and how many Courses more than one
    // Tournament is played on, which is the only kind a venue record can be derived from.
    const [linked] = await db
      .select({
        tournaments: count(),
        linked: count(tournaments.courseId),
        courses: countDistinct(tournaments.courseId),
      })
      .from(tournaments);
    const [all] = await db.select({ n: count() }).from(courses);
    const revisited = await db
      .select({ courseId: tournaments.courseId })
      .from(tournaments)
      .where(isNotNull(tournaments.courseId))
      .groupBy(tournaments.courseId)
      .having(sql`count(*) > 1`);

    console.log(
      `\n${linked?.linked ?? 0} of ${linked?.tournaments ?? 0} stored Tournaments have a ` +
        `course_id (${named} named a Course), across ${linked?.courses ?? 0} of the ` +
        `${all?.n ?? 0} Courses stored. ${untrusted} of the ${plan.rows.length} fetched this ` +
        `run have untrusted holes, ${unchecked} holes that could not be checked.`,
    );
    console.log(
      `${revisited.length} Courses have more than one Tournament linked to them, which is ` +
        "where a venue record can come from.",
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
