// `npm run ingest:schedule`. Reads the current PGA Tour season's schedule from Wikipedia and
// writes one `tournaments` row per event. See docs/adr/0002 for what this source was checked
// to hold, and the "Ingest the PGA Tour schedule" Ticket for what this script must do.

import { client, db } from "../db/client";
import {
  buildTournamentRecords,
  resolveCourseNames,
  upsertTournaments,
} from "../lib/schedule/ingest";
import { parseSchedule } from "../lib/schedule/parse";
import { currentSeasonYear, parseRegularSeasonRange } from "../lib/schedule/season";
import { fetchIntro, fetchSection, revisionUrl } from "../lib/schedule/wikipedia";

// A silently half-parsed schedule is worse than no schedule at all.
const MINIMUM_TOURNAMENTS = 30;

async function main(): Promise<void> {
  const now = new Date();
  const candidateYear = now.getUTCFullYear();

  const intro = await fetchIntro(`${candidateYear} PGA Tour`);
  const regularSeason = parseRegularSeasonRange(intro.wikitext);
  const season = currentSeasonYear(candidateYear, regularSeason.end, now);
  const title = `${season} PGA Tour`;

  console.log(`Reading the ${title} article's Schedule section from Wikipedia...`);
  const section = await fetchSection(title, "Schedule");
  const rows = parseSchedule(section.wikitext, season);
  const canceled = rows.filter((row) => row.canceled);
  const active = rows.filter((row) => !row.canceled);
  console.log(
    `Parsed ${rows.length} rows (${canceled.length} canceled, ${active.length} to ingest).`,
  );

  if (active.length < MINIMUM_TOURNAMENTS) {
    console.error(
      `Only ${active.length} tournaments parsed; at least ${MINIMUM_TOURNAMENTS} are expected ` +
        `for a full season. Refusing to write a silently half-parsed schedule.`,
    );
    process.exitCode = 1;
    await client.end();
    return;
  }

  console.log(
    `Resolving each tournament's Course name from its own article, throttled to one request a second (about ${active.length} seconds)...`,
  );
  const courseNames = await resolveCourseNames(active.map((row) => row.pageTitle));

  const sourceUrl = revisionUrl(section.title, section.revid);
  const records = buildTournamentRecords(rows, season, sourceUrl, courseNames);

  await upsertTournaments(db, records);

  const withCourse = records.filter((record) => record.courseName !== null).length;
  console.log(`Wrote ${records.length} tournaments for the ${season} season.`);
  console.log(`Source: ${sourceUrl}`);
  console.log(
    `${withCourse} of ${records.length} resolved a Course name from their own article.`,
  );

  await client.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exitCode = 1;
  await client.end();
});
