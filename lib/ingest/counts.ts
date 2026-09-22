// What a finished ingest left in the database, counted, so a run whose every stage exited 0
// but that stored nothing is still visible. A healthy run, verified locally on 2026-09-22:
// 45 Tournaments, 1,592 Players, 31 Courses with 259 Traits, 1,518 results across both
// seasons, and 102 Players with a non-null Skill.

export type IngestCounts = {
  tournaments: number;
  players: number;
  courses: number;
  courseTraits: number;
  /** Results per season, most recent first. */
  resultsBySeason: { season: number; results: number }[];
  /** Players with a Skill that rests on enough results to be stated. */
  playersWithSkill: number;
};

/** One row per count, as the report prints them. */
export function countRows(counts: IngestCounts): [string, number][] {
  return [
    ["Tournaments", counts.tournaments],
    ["Players", counts.players],
    ["Courses", counts.courses],
    ["Course Traits", counts.courseTraits],
    ...counts.resultsBySeason.map(({ season, results }): [string, number] => [
      `Results, ${season} season`,
      results,
    ]),
    ["Players with a Skill", counts.playersWithSkill],
  ];
}

/**
 * Every table a healthy run cannot have left empty, named. A stage that exits 0 having
 * written nothing is the silent half-run this exists to catch, so each is a failure.
 */
export function emptyTables(counts: IngestCounts): string[] {
  const empty = countRows(counts)
    .filter(([, n]) => n === 0)
    .map(([label]) => label);
  if (counts.resultsBySeason.length === 0) empty.push("Results, in any season");
  return empty;
}
