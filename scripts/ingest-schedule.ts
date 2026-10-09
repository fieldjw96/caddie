// `npm run ingest:schedule`. Reads every PGA Tour season this repo holds from Wikipedia and
// writes one `tournaments` row per event. See docs/adr/0002 for what this source was checked
// to hold, and the "Ingest the PGA Tour schedule" Ticket for what this script must do.
//
// Every season `ingest:results` reads, not only the current one: a past Tournament's own
// article is where the Course it was played on is stated, and a past Tournament linked to no
// Course takes its whole leaderboard out of reach of a venue record. See `seasonsToIngest`.

import { client, db } from "../db/migration-client";
import {
  buildTournamentRecords,
  resolveCourseFacts,
  upsertTournaments,
} from "../lib/schedule/ingest";
import { parseSchedule } from "../lib/schedule/parse";
import {
  currentSeasonYear,
  parseRegularSeasonRange,
  seasonsToIngest,
} from "../lib/schedule/season";
import { fetchIntro, fetchSection, revisionUrl } from "../lib/schedule/wikipedia";

// A silently half-parsed schedule is worse than no schedule at all.
const MINIMUM_TOURNAMENTS = 30;

/** What one season left behind, or null where it was read but refused. */
interface SeasonOutcome {
  season: number;
  written: number;
  withCourse: number;
  withFacts: number;
  sourceUrl: string;
}

/**
 * Reads and writes one season, or returns null having said why it wrote nothing. A season that
 * parses too few Tournaments is refused rather than written: see MINIMUM_TOURNAMENTS.
 */
async function ingestSeason(season: number): Promise<SeasonOutcome | null> {
  const title = `${season} PGA Tour`;
  console.log(`\n== ${title} ==`);
  const section = await fetchSection(title, "Schedule");
  const rows = parseSchedule(section.wikitext, season);
  const canceled = rows.filter((row) => row.canceled);
  const active = rows.filter((row) => !row.canceled);
  console.log(
    `Parsed ${rows.length} rows (${canceled.length} canceled, ${active.length} to ingest).`,
  );

  if (active.length < MINIMUM_TOURNAMENTS) {
    console.error(
      `Only ${active.length} tournaments parsed for ${season}; at least ` +
        `${MINIMUM_TOURNAMENTS} are expected for a full season. Refusing to write a silently ` +
        "half-parsed schedule.",
    );
    return null;
  }

  console.log(
    `Resolving each tournament's Course, par and yardage from its own article, throttled to one request a second (about ${active.length} seconds)...`,
  );
  const courseFacts = await resolveCourseFacts(active.map((row) => row.pageTitle));

  const sourceUrl = revisionUrl(section.title, section.revid);
  const records = buildTournamentRecords(rows, season, sourceUrl, courseFacts);
  await upsertTournaments(db, records);

  const withCourse = records.filter((record) => record.courseName !== null).length;
  const withFacts = records.filter(
    (record) => record.coursePar !== null && record.courseYardage !== null,
  ).length;
  console.log(`Wrote ${records.length} tournaments for the ${season} season.`);
  console.log(`Source: ${sourceUrl}`);
  console.log(
    `${withCourse} of ${records.length} resolved a Course name from their own article, ` +
      `${withFacts} its par and yardage too.`,
  );
  return { season, written: records.length, withCourse, withFacts, sourceUrl };
}

async function main(): Promise<void> {
  const now = new Date();
  const candidateYear = now.getUTCFullYear();

  const intro = await fetchIntro(`${candidateYear} PGA Tour`);
  const regularSeason = parseRegularSeasonRange(intro.wikitext);
  const current = currentSeasonYear(candidateYear, regularSeason.end, now);
  const seasons = seasonsToIngest(current, now.toISOString().slice(0, 10));
  console.log(
    `Reading the Schedule section of ${seasons.map((s) => `${s} PGA Tour`).join(", ")} ` +
      `from Wikipedia. The current season is ${current}.`,
  );

  const outcomes: SeasonOutcome[] = [];
  for (const season of seasons) {
    const outcome = await ingestSeason(season);
    if (outcome !== null) {
      outcomes.push(outcome);
      continue;
    }
    // The current season is the one the page renders, so its schedule is the run. A past
    // season's is history: losing it costs a venue record its depth, which the ingest's own
    // report counts, and is not a reason to leave the site without a next Tournament.
    if (season === current) {
      console.error(`${season} is the current season, so nothing else was read.`);
      process.exitCode = 1;
      return;
    }
    console.error(`${season} is a past season, so the run carries on without it.`);
  }

  console.log("\n== All seasons ==");
  for (const o of outcomes) {
    console.log(
      `${o.season}: ${o.written} tournaments, ${o.withCourse} with a Course name, ` +
        `${o.withFacts} with its par and yardage too.`,
    );
  }
  console.log(
    `Wrote ${outcomes.reduce((n, o) => n + o.written, 0)} tournaments across ` +
      `${outcomes.length} of ${seasons.length} seasons read.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
