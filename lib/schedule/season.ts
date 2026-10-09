// Which "<year> PGA Tour" article is the current one. Wikipedia titles each season article by
// the calendar year most of it falls in, and each carries the season's own start and end date
// in its infobox, so "current" is worked out from those rather than assumed from today's year:
// once a season's regular season has ended, the next year's article is current even before
// that article's own schedule fully settles.

import { defaultSeasons } from "../results/season";

const REGULAR_SEASON_FIELD =
  /regular_season\s*=\s*\{\{[Ss]tart date\|(\d+)\|(\d+)\|(\d+)[^}]*\}\}\s*[–—-]\s*\{\{[Ee]nd date\|(\d+)\|(\d+)\|(\d+)[^}]*\}\}/;

function toUtcDate(year: string, month: string, day: string): Date {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** The `regular_season` field of `{{Infobox golf season}}`, as a start/end pair. */
export function parseRegularSeasonRange(introWikitext: string): { start: Date; end: Date } {
  const match = REGULAR_SEASON_FIELD.exec(introWikitext);
  if (!match) {
    throw new Error(
      'The season infobox has no "regular_season" field in the expected "{{Start date|...}} – {{end date|...}}" shape.',
    );
  }
  const [, sy, sm, sd, ey, em, ed] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return { start: toUtcDate(sy, sm, sd), end: toUtcDate(ey, em, ed) };
}

/** The season year whose article is current, given the year the regular season ended. */
export function currentSeasonYear(
  candidateYear: number,
  regularSeasonEnd: Date,
  now: Date,
): number {
  return now > regularSeasonEnd ? candidateYear + 1 : candidateYear;
}

/**
 * Every season `ingest:schedule` reads, oldest first: the current one, and the ones
 * `ingest:results` reads.
 *
 * A past season is read for the same reason the current one is — its Tournaments' own articles
 * state which Course each was played on, and a Course nothing points at has no venue record in
 * it. `ingest:results` creates those Tournaments too, from the same schedule tables, but only
 * their names and dates; the venue facts are an article apart and are this stage's to store.
 * Reading them here rather than there is what keeps the ingest's order honest: the schedule is
 * stored before `ingest:courses` matches it, so a season arrives linked in the same run rather
 * than the next one.
 */
export function seasonsToIngest(currentSeason: number, today: string): number[] {
  return [...new Set([...defaultSeasons(today), currentSeason])].sort((a, b) => a - b);
}
