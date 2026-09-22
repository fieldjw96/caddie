// `npm run derive:strengths`. Derives every Player's Skill, Form and venue record at the next
// Tournament's Course from the results already stored, and replaces `player_strengths` with
// them. Reads nothing from the network. See lib/strengths/derive.ts for what each Strength is
// and why most of them are null.
//
// `npm run derive:strengths -- 2026-06-01` derives as of a named day instead of today.

import { client, db } from "../db/client";
import { players, tournaments } from "../db/schema";
import {
  deriveStrengths,
  fieldsFromResults,
  FORM_WINDOW_DAYS,
  MINIMUM_SAMPLE,
  type PlayerStrengths,
  type StoredResult,
} from "../lib/strengths/derive";
import { loadResults, replaceStrengths, strengthRecords } from "../lib/strengths/store";
import { nextTournament } from "../lib/schedule/next-tournament";

async function main(): Promise<void> {
  const named = process.argv[2];
  if (named !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(named)) {
    throw new Error(`"${named}" is not a YYYY-MM-DD date.`);
  }
  const now = named === undefined ? new Date() : new Date(`${named}T00:00:00Z`);
  const asOf = now.toISOString().slice(0, 10);

  const schedule = await db
    .select({
      name: tournaments.name,
      startDate: tournaments.startDate,
      courseId: tournaments.courseId,
    })
    .from(tournaments);
  const next = nextTournament(schedule, now);
  const courseId = next?.courseId ?? null;

  const rows = await loadResults(db);
  const fields = fieldsFromResults(rows);
  const byPlayer = new Map<number, StoredResult[]>();
  for (const row of rows)
    byPlayer.set(row.playerId, [...(byPlayer.get(row.playerId) ?? []), row]);

  const playerIds = (await db.select({ id: players.id }).from(players)).map((p) => p.id);
  const derived = new Map<number, PlayerStrengths>();
  for (const id of playerIds) {
    derived.set(id, deriveStrengths(byPlayer.get(id) ?? [], fields, { asOf, courseId }));
  }
  await replaceStrengths(db, strengthRecords(derived, courseId));

  const all = [...derived.values()];
  const count = (test: (s: PlayerStrengths) => boolean) => all.filter(test).length;
  const withResults = count((s) => s.skill.sampleSize > 0);

  console.log(
    `As of ${asOf}. Minimum sample ${MINIMUM_SAMPLE}; Form window ${FORM_WINDOW_DAYS} days.`,
  );
  console.log(
    next === null
      ? "No next Tournament is scheduled, so no venue record was derived."
      : courseId === null
        ? `Next Tournament: ${next.name}, whose Course is not matched to a \`courses\` row, so no venue record was derived.`
        : `Next Tournament: ${next.name}, at course #${courseId}.`,
  );
  console.log(
    `Players: ${all.length}, of whom ${withResults} have at least one usable result.`,
  );
  console.log(`Non-null Skill: ${count((s) => s.skill.value !== null)}`);
  console.log(`Non-null Form: ${count((s) => s.form.value !== null)}`);
  console.log(`Non-null venue record: ${count((s) => s.venueRecord?.value != null)}`);
  console.log(
    `Nothing at all (every Strength null): ${count(
      (s) => s.skill.value === null && s.form.value === null && s.venueRecord?.value == null,
    )}`,
  );

  await client.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exitCode = 1;
  await client.end();
});
