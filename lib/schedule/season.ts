// Which "<year> PGA Tour" article is the current one. Wikipedia titles each season article by
// the calendar year most of it falls in, and each carries the season's own start and end date
// in its infobox, so "current" is worked out from those rather than assumed from today's year:
// once a season's regular season has ended, the next year's article is current even before
// that article's own schedule fully settles.

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
