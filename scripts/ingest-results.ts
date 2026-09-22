// `npm run ingest:results`. Reads every finishing position openly available for the most
// recent PGA Tour season whose article carries final FedEx Cup standings, and writes one
// `results` row per matched Player per Tournament. Two shapes of table, recorded apart in
// `results.basis` because they are not equally trustworthy:
//
// - the season article's FedEx Cup standings table, the top 30 Players' finishes in the
//   majors, the Players, the signature events and the playoffs;
// - each event's own full-field leaderboard, with round scores, where the season's schedule
//   links the event to an article of its own (the majors and the Players).
//
// Regular tour events have neither, and nothing here pretends otherwise. See docs/adr/0002.
//
// `npm run ingest:results -- 2025` reads a named season instead of the most recent one.

import { client, db } from "../db/client";
import { players } from "../db/schema";
import { buildResultRecords, ensureTournaments, upsertResults } from "../lib/results/ingest";
import type { SourcedEvent } from "../lib/results/ingest";
import { parseLeaderboard } from "../lib/results/leaderboard";
import { PlayerIndex } from "../lib/results/names";
import { readStandings } from "../lib/results/standings";
import type { EventFailure } from "../lib/results/types";
import { parseSchedule } from "../lib/schedule/parse";
import {
  fetchArticle,
  fetchSection,
  revisionUrl,
  type WikitextArticle,
} from "../lib/schedule/wikipedia";

// ADR 0002 counted about six full-field leaderboards a season, and the standings table adds
// more. Fewer than this means the parse broke, not that the season got thinner.
const MINIMUM_EVENTS = 6;

/** How many seasons back to look for one whose article has its final standings. */
const SEASONS_TO_TRY = 3;

async function findSeason(): Promise<{ season: number; standings: WikitextArticle }> {
  const named = process.argv[2];
  if (named !== undefined) {
    const season = Number(named);
    if (!Number.isInteger(season)) throw new Error(`"${named}" is not a season year.`);
    return { season, standings: await fetchSection(`${season} PGA Tour`, "Standings") };
  }
  const thisYear = new Date().getUTCFullYear();
  for (let season = thisYear; season > thisYear - SEASONS_TO_TRY; season--) {
    try {
      return { season, standings: await fetchSection(`${season} PGA Tour`, "Standings") };
    } catch {
      console.log(`The ${season} PGA Tour article has no FedEx Cup standings yet.`);
    }
  }
  throw new Error(
    `None of the last ${SEASONS_TO_TRY} season articles has FedEx Cup standings.`,
  );
}

async function main(): Promise<void> {
  const { season, standings } = await findSeason();
  const seasonTitle = `${season} PGA Tour`;
  console.log(`Season: ${season}.`);

  const schedule = await fetchSection(seasonTitle, "Schedule");
  const scheduleRows = parseSchedule(schedule.wikitext, season);

  const events: SourcedEvent[] = [];
  const failures: EventFailure[] = [];

  const standingsUrl = revisionUrl(standings.title, standings.revid);
  const parsedStandings = readStandings(standings.wikitext);
  events.push(...parsedStandings.events.map((e) => ({ ...e, sourceUrl: standingsUrl })));
  failures.push(...parsedStandings.failures);
  console.log(
    `Standings table: ${parsedStandings.events.length} events read, ${parsedStandings.failures.length} failed.`,
  );

  // An event has a leaderboard to read when the schedule links it to an article for this
  // edition rather than to the event's general article: `2025 Masters Tournament`, not
  // `Genesis Invitational`.
  const editionArticles = scheduleRows
    .filter((row) => !row.canceled && row.pageTitle.startsWith(`${season} `))
    .map((row) => row.pageTitle);
  console.log(
    `Reading ${editionArticles.length} event leaderboards, one request a second: ${editionArticles.join(", ")}.`,
  );
  for (const title of editionArticles) {
    try {
      const article = await fetchArticle(title);
      events.push({
        pageTitle: title,
        basis: "leaderboard",
        entries: parseLeaderboard(article.wikitext),
        sourceUrl: revisionUrl(article.title, article.revid),
      });
    } catch (error) {
      failures.push({
        pageTitle: title,
        basis: "leaderboard",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const playerRows = await db.select({ id: players.id, name: players.name }).from(players);
  const index = new PlayerIndex(playerRows);

  // A dry run first, against the schedule rather than the database, so that a run refused
  // below has written nothing at all, Tournaments included. The row numbers stand in for ids.
  const scheduled = scheduleRows.filter((row) => !row.canceled);
  const dryRun = buildResultRecords(
    events,
    new Map(scheduled.map((row, i) => [row.pageTitle, i])),
    index,
  );
  const yielded = new Set(dryRun.records.map((r) => r.tournamentId));

  for (const failure of failures) {
    console.error(`FAILED ${failure.pageTitle} (${failure.basis}): ${failure.reason}`);
  }
  for (const title of dryRun.unscheduled) {
    console.error(`FAILED ${title}: the ${season} schedule has no Tournament linked to it.`);
  }

  if (yielded.size < MINIMUM_EVENTS) {
    console.error(
      `Only ${yielded.size} events yielded results; at least ${MINIMUM_EVENTS} are expected for ` +
        `a complete season. Refusing to write: that means the parse broke, or \`players\` is empty.`,
    );
    process.exitCode = 1;
    await client.end();
    return;
  }

  const tournamentIds = await ensureTournaments(
    db,
    scheduleRows,
    season,
    revisionUrl(schedule.title, schedule.revid),
  );
  const built = buildResultRecords(events, tournamentIds, index);
  await upsertResults(db, built.records);
  const written = new Set(built.records.map((r) => r.tournamentId));

  const byBasis = (basis: string) => built.records.filter((r) => r.basis === basis).length;
  const withRounds = built.records.filter((r) => r.round1 !== null).length;
  const unmatchedLines = [...built.unmatched.values()].reduce((a, b) => a + b, 0);

  console.log("");
  console.log(`Season: ${season}`);
  console.log(`Events that yielded results: ${written.size}`);
  console.log(
    `Rows written: ${built.records.length} (${byBasis("leaderboard")} from full-field leaderboards, ` +
      `${byBasis("standings")} from the standings table; ${withRounds} with round scores)`,
  );
  console.log(`Events that failed to parse: ${failures.length + built.unscheduled.length}`);
  console.log(
    `Unmatched names: ${built.unmatched.size} (on ${unmatchedLines} lines), not created as players:`,
  );
  const sorted = [...built.unmatched].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [name, count] of sorted) console.log(`  ${count}  ${name}`);
  if (built.ambiguous.size > 0) {
    console.log(`Ambiguous names, matching more than one player and so matched to none:`);
    for (const [name, count] of built.ambiguous) console.log(`  ${count}  ${name}`);
  }
  console.log(`Source: Wikipedia, CC BY-SA 4.0. Standings: ${standingsUrl}`);

  await client.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exitCode = 1;
  await client.end();
});
