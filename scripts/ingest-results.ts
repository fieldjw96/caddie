// `npm run ingest:results`. Reads every finishing position openly available for last season
// and this one, and writes one `results` row per matched Player per Tournament. Two shapes of
// table, recorded apart in `results.basis` because they are not equally trustworthy:
//
// - each event's own full-field leaderboard, with round scores, where the season's schedule
//   links the event to an article of its own (the majors and the Players). Read directly,
//   as soon as the event has been played, whether or not the season is over;
// - the season article's FedEx Cup standings table, the top 30 Players' finishes in the
//   majors, the Players, the signature events and the playoffs. Only there once a season is
//   over, and still read where it is, because it is the only source of finishes in the
//   signature events and the playoffs.
//
// A season in progress has no standings table and some events still to play. Neither is a
// failure: the run says which path produced what, and counts what it skipped. Regular tour
// events have neither table, and nothing here pretends otherwise. See docs/adr/0002 and
// lib/results/season.ts for which seasons are read and why.
//
// `npm run ingest:results -- 2025` reads one named season instead.

import { inArray, max } from "drizzle-orm";
import { client, db } from "../db/client";
import { players, tournaments } from "../db/schema";
import { buildResultRecords, ensureTournaments, upsertResults } from "../lib/results/ingest";
import type { ResultRecord, SourcedEvent } from "../lib/results/ingest";
import { parseLeaderboard } from "../lib/results/leaderboard";
import { PlayerIndex } from "../lib/results/names";
import { defaultSeasons, enoughEvents, eventArticles } from "../lib/results/season";
import { readStandings } from "../lib/results/standings";
import type { EventFailure } from "../lib/results/types";
import { parseSchedule } from "../lib/schedule/parse";
import {
  fetchArticle,
  fetchSection,
  MissingArticleError,
  revisionUrl,
  type WikitextArticle,
} from "../lib/schedule/wikipedia";

function seasonsToRead(today: string): number[] {
  const named = process.argv[2];
  if (named === undefined) return defaultSeasons(today);
  const season = Number(named);
  if (!Number.isInteger(season)) throw new Error(`"${named}" is not a season year.`);
  return [season];
}

/** The season's standings section, or null where the article has none yet. */
async function standingsSection(seasonTitle: string): Promise<WikitextArticle | null> {
  try {
    return await fetchSection(seasonTitle, "Standings");
  } catch (error) {
    if (error instanceof Error && /has no "Standings" section/.test(error.message))
      return null;
    throw error;
  }
}

interface SeasonOutcome {
  season: number;
  written: ResultRecord[];
  refused: boolean;
}

async function ingestSeason(
  season: number,
  today: string,
  index: PlayerIndex,
): Promise<SeasonOutcome> {
  const seasonTitle = `${season} PGA Tour`;
  console.log(`\n== ${seasonTitle} ==`);

  const schedule = await fetchSection(seasonTitle, "Schedule");
  const scheduleRows = parseSchedule(schedule.wikitext, season);

  const events: SourcedEvent[] = [];
  const failures: EventFailure[] = [];

  const standings = await standingsSection(seasonTitle);
  const standingsUrl =
    standings === null ? null : revisionUrl(standings.title, standings.revid);
  if (standingsUrl === null || standings === null) {
    console.log(
      "Standings table: none yet, as for any season in progress. Leaderboards only; " +
        "no signature event or playoff finishes this season until it appears.",
    );
  } else {
    const parsed = readStandings(standings.wikitext);
    events.push(...parsed.events.map((e) => ({ ...e, sourceUrl: standingsUrl })));
    failures.push(...parsed.failures);
    console.log(
      `Standings table: ${parsed.events.length} events read, ${parsed.failures.length} failed.`,
    );
  }

  const { played, notYetPlayed } = eventArticles(scheduleRows, season, today);
  const missing: string[] = [];
  console.log(
    `Reading ${played.length} event leaderboards, one request a second: ${played.join(", ") || "none"}.`,
  );
  for (const title of played) {
    try {
      const article = await fetchArticle(title);
      events.push({
        pageTitle: title,
        basis: "leaderboard",
        entries: parseLeaderboard(article.wikitext),
        sourceUrl: revisionUrl(article.title, article.revid),
      });
    } catch (error) {
      if (error instanceof MissingArticleError) {
        missing.push(title);
        continue;
      }
      failures.push({
        pageTitle: title,
        basis: "leaderboard",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const leaderboardsRead = played.length - missing.length;

  // A dry run first, against the schedule rather than the database, so that a season refused
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

  if (!enoughEvents(yielded.size, { hasStandings: standings !== null, leaderboardsRead })) {
    console.error(
      `Only ${yielded.size} events yielded results from ${leaderboardsRead} leaderboards` +
        `${standings ? " and the standings table" : ""}. Refusing to write ${season}: that ` +
        "means the parse broke, or `players` is empty.",
    );
    return { season, written: [], refused: true };
  }

  const tournamentIds = await ensureTournaments(
    db,
    scheduleRows,
    season,
    revisionUrl(schedule.title, schedule.revid),
  );
  const built = buildResultRecords(events, tournamentIds, index);
  await upsertResults(db, built.records);

  const eventsFrom = (basis: string) =>
    new Set(built.records.filter((r) => r.basis === basis).map((r) => r.tournamentId)).size;
  const rowsFrom = (basis: string) => built.records.filter((r) => r.basis === basis).length;
  const withRounds = built.records.filter((r) => r.round1 !== null).length;
  const unmatchedLines = [...built.unmatched.values()].reduce((a, b) => a + b, 0);

  console.log(
    `Events that yielded results: ${new Set(built.records.map((r) => r.tournamentId)).size}`,
  );
  console.log(
    `Rows written: ${built.records.length}: ${rowsFrom("leaderboard")} from ` +
      `${eventsFrom("leaderboard")} full-field leaderboards (${withRounds} with round scores), ` +
      `${rowsFrom("standings")} from the standings table for ${eventsFrom("standings")} events`,
  );
  console.log(
    `Skipped, not yet played: ${notYetPlayed.length}${notYetPlayed.length ? ` (${notYetPlayed.join(", ")})` : ""}`,
  );
  console.log(
    `Skipped, played but no article yet: ${missing.length}${missing.length ? ` (${missing.join(", ")})` : ""}`,
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
  if (standingsUrl) console.log(`Source: Wikipedia, CC BY-SA 4.0. Standings: ${standingsUrl}`);
  else console.log("Source: Wikipedia, CC BY-SA 4.0.");

  return { season, written: built.records, refused: false };
}

async function main(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const seasons = seasonsToRead(today);
  console.log(`Today: ${today}. Seasons: ${seasons.join(", ")}.`);

  const playerRows = await db.select({ id: players.id, name: players.name }).from(players);
  const index = new PlayerIndex(playerRows);

  const outcomes: SeasonOutcome[] = [];
  for (const season of seasons) outcomes.push(await ingestSeason(season, today, index));

  const written = outcomes.flatMap((o) => o.written);
  const ids = [...new Set(written.map((r) => r.tournamentId))];
  const [newest] =
    ids.length === 0
      ? [{ endDate: null }]
      : await db
          .select({ endDate: max(tournaments.endDate) })
          .from(tournaments)
          .where(inArray(tournaments.id, ids));

  console.log("\n== All seasons ==");
  for (const o of outcomes) {
    console.log(
      `${o.season}: ${o.refused ? "REFUSED, nothing written" : `${o.written.length} rows`}`,
    );
  }
  console.log(`Rows written: ${written.length}`);
  console.log(`Newest result written: Tournament ending ${newest?.endDate ?? "none"}`);

  if (outcomes.some((o) => o.refused)) process.exitCode = 1;
  await client.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exitCode = 1;
  await client.end();
});
