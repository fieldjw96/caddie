// Which seasons `ingest:results` reads, and which of a season's event articles it reads now.
// Pure: no network and no clock, so today is an argument.
//
// A season's event articles are read directly, whether or not its article has FedEx Cup
// standings yet. Waiting for the standings, which appear only once the season is over, left
// the site a season behind and Form, whose window is 180 days, with nothing inside it.
//
// Two seasons are read by default, this calendar year's and last year's, because the Form
// window straddles New Year for half of every year: in March the last 180 days are mostly the
// previous season's autumn. Seasons before that are not read by default; see ADR 0002 for how
// thin they are anyway.

import type { ScheduleRow } from "../schedule/parse";

/** The seasons a run reads by default, oldest first, as of `today` (`YYYY-MM-DD`). */
export function defaultSeasons(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return [year - 1, year];
}

export interface EventArticles {
  /** Articles for events that have finished, to be read for a leaderboard. */
  played: string[];
  /** Articles for events still to finish: not fetched, counted, and not a failure. */
  notYetPlayed: string[];
}

/**
 * The season's per-edition event articles: `2026 Masters Tournament`, not `Genesis
 * Invitational`, which is how the schedule marks an event that has a leaderboard of its own
 * to read. An event is played once its last scheduled day is before today. One ending today
 * is not: its article is still being written up while it is being played.
 *
 * An article existing is no sign an event has been played; Wikipedia holds stubs for events
 * a year and more away. The schedule's dates are what says so.
 */
export function eventArticles(
  rows: readonly ScheduleRow[],
  season: number,
  today: string,
): EventArticles {
  const editions = rows.filter(
    (row) => !row.canceled && row.pageTitle.startsWith(`${season} `),
  );
  const titles = (list: readonly ScheduleRow[]) => [
    ...new Set(list.map((row) => row.pageTitle)),
  ];
  const played = titles(editions.filter((row) => row.endDate < today));
  const notYetPlayed = titles(editions.filter((row) => row.endDate >= today));
  return { played, notYetPlayed: notYetPlayed.filter((title) => !played.includes(title)) };
}

/** A complete season with standings yields at least this many events; ADR 0002 counts ~6. */
export const MINIMUM_EVENTS_WITH_STANDINGS = 6;

/**
 * Whether a season read yielded enough events to be worth writing, or whether the shortfall
 * means the parse broke or `players` is empty. With the standings table, the old bar of a
 * complete season. Without it, a season in progress, at least half the leaderboards read:
 * one article misread costs that event, but most of them failing is the parser, not the
 * season. A season with nothing played yet has nothing to write and is not refused.
 */
export function enoughEvents(
  yielded: number,
  options: { hasStandings: boolean; leaderboardsRead: number },
): boolean {
  if (options.hasStandings) return yielded >= MINIMUM_EVENTS_WITH_STANDINGS;
  if (options.leaderboardsRead === 0) return true;
  return yielded >= Math.ceil(options.leaderboardsRead / 2);
}
