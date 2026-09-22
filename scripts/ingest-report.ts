// `npm run ingest:report` counts what the ingest left in the database: Tournaments, Players,
// Courses, Course Traits, results per season and Players with a Skill. The last stage of the
// production workflow, so a run that exited 0 everywhere and stored nothing still shows, in
// the log and in the job summary. Exits non-zero if any of them is empty. Reads only.

import { appendFileSync } from "node:fs";
import { and, count, countDistinct, desc, eq, isNotNull } from "drizzle-orm";
import { client, db } from "../db/client";
import {
  courses,
  courseTraits,
  players,
  playerStrengths,
  results,
  tournaments,
} from "../db/schema";
import { countRows, emptyTables, type IngestCounts } from "../lib/ingest/counts";
import { strengthKey } from "../lib/strengths/store";

async function total(
  table: typeof tournaments | typeof players | typeof courses | typeof courseTraits,
) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function main(): Promise<void> {
  const resultsBySeason = await db
    .select({ season: tournaments.season, results: count() })
    .from(results)
    .innerJoin(tournaments, eq(results.tournamentId, tournaments.id))
    .groupBy(tournaments.season)
    .orderBy(desc(tournaments.season));
  const [skill] = await db
    .select({ n: countDistinct(playerStrengths.playerId) })
    .from(playerStrengths)
    .where(
      and(
        eq(playerStrengths.strength, strengthKey("skill", null)),
        isNotNull(playerStrengths.value),
      ),
    );

  const counts: IngestCounts = {
    tournaments: await total(tournaments),
    players: await total(players),
    courses: await total(courses),
    courseTraits: await total(courseTraits),
    resultsBySeason,
    playersWithSkill: skill?.n ?? 0,
  };

  const rows = countRows(counts);
  const width = Math.max(...rows.map(([label]) => label.length));
  console.log("What production holds after this run:");
  for (const [label, n] of rows)
    console.log(`  ${label.padEnd(width)}  ${n.toLocaleString("en-GB")}`);

  const empty = emptyTables(counts);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const lines = [
      "",
      "### What production holds",
      "",
      "| | Rows |",
      "| --- | ---: |",
      ...rows.map(([label, n]) => `| ${label} | ${n.toLocaleString("en-GB")} |`),
      "",
    ];
    if (empty.length > 0) lines.push(`**Empty after a full run:** ${empty.join(", ")}.`, "");
    appendFileSync(summary, lines.join("\n") + "\n");
  }

  if (empty.length > 0) {
    console.error(
      `Empty after a full run, which a healthy run never leaves: ${empty.join(", ")}.`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
