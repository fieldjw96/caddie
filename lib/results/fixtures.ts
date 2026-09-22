// Wikitext shaped like the real articles, built rather than copied. The real standings
// section cites hosts that ADR 0001 prohibits, and a fixture carrying their URLs would be
// exactly what the forbidden-sources CI job exists to catch.

export interface StandingsFixtureRow {
  position?: string;
  player: string;
  majors: string[];
  signature: string[];
  playoffs: string[];
  tourChampionship?: string;
}

const MAJOR_TARGETS = [
  "2025 Players Championship",
  "2025 Masters Tournament",
  "2025 PGA Championship",
  "2025 U.S. Open (golf)",
  "2025 Open Championship",
];
const SIGNATURE_TARGETS = [
  "The Sentry (Hawaii)",
  "AT&T Pebble Beach Pro-Am",
  "Genesis Invitational",
  "Arnold Palmer Invitational",
  "RBC Heritage",
  "Truist Championship",
  "Memorial Tournament",
  "Travelers Championship",
];
const PLAYOFF_TARGETS = ["FedEx St. Jude Championship", "BMW Championship (PGA Tour)"];

export const STANDINGS_TARGETS = [...MAJOR_TARGETS, ...SIGNATURE_TARGETS, ...PLAYOFF_TARGETS];

const abbr = (target: string) => `!style="width:26px;"|{{abbr|[[${target}|X]]|${target}}}`;
const cells = (values: string[]) =>
  values.map((v) => `style="background:#afeeee"|${v}`).join(" || ");

export function standingsRow(row: StandingsFixtureRow): string {
  const lead = row.position
    ? `|${row.position} ||{{flagicon|USA}}|| style="text-align:left" |${row.player}`
    : `|{{flagicon|USA}}|| style="text-align:left" |${row.player}`;
  return [
    lead,
    `<!--MajorsPly-->| ${cells(row.majors)}`,
    `<!--Signature-->| ${cells(row.signature)}`,
    `<!--Other PGA-->| style="background:yellow"|[[Charles Schwab Challenge|T4]] ||  ||  ||  || `,
    `<!--RegSeasonPts-->! 1,783`,
    `<!--PlayoffEvents-->|${cells(row.playoffs)}`,
    `<!--PostPlayoffPts-->! 2,923`,
    ...(row.tourChampionship === undefined
      ? []
      : [`<!--TourChampScore-->|${row.tourChampionship}`]),
    `<!--Starts-->| 19`,
    `<!--Money, Update at end of season only-->|18.50 || 2.75 || 12.00`,
  ].join("\n");
}

export function standingsSection(rows: StandingsFixtureRow[]): string {
  return [
    "===Standings===",
    "Final [[FedEx Cup]] standings of the 30 qualifiers for the [[Tour Championship]]:",
    "",
    '{| class="wikitable"',
    "!rowspan=2|{{abbr|Pos.|Ranking position}}",
    "!colspan=2|Player",
    "!colspan=5|Majors",
    "!rowspan=2|{{abbr|[[Tour Championship|Tour C'ship]]|Tour Championship}}",
    "|-",
    "!{{abbr|Nat.|Nationality}}",
    "!Name",
    ...STANDINGS_TARGETS.map(abbr),
    '!style="width:18px;"|1',
    '!style="width:28px;"|Basic',
    ...rows.map((row) => `|-\n${standingsRow(row)}`),
    "|}",
    "{{legend|transparent|Did not play|text=•}}",
  ].join("\n");
}

/** Thirty distinct players, the first leading alone and the rest in pairs of ties. */
export function thirtyStandingsRows(): StandingsFixtureRow[] {
  return Array.from({ length: 30 }, (_, i) => {
    const tieStart = i === 0 || i % 2 === 1;
    const position = i === 0 ? "1" : `T${i % 2 === 1 ? i + 1 : i}`;
    return {
      position: tieStart ? position : undefined,
      player: `[[Player Number${i + 1} (golfer)|Number${i + 1}]]`,
      majors: ["T14", "T21", "CUT", "•", "'''1'''"],
      signature: ["•", "T22", "T5", "T11", "7", "T4", "WD", "T2"],
      playoffs: ["T3", "•"],
      tourChampionship: tieStart ? ` −${30 - i}` : undefined,
    };
  });
}

export interface LeaderboardLine {
  place?: string;
  player: string;
  score: string;
}

export function leaderboardArticle(
  lines: LeaderboardLine[],
  heading: string | null = "Final leaderboard",
): string {
  const body = lines
    .map((line) => {
      const place = line.place === undefined ? "|" : `|align=center|${line.place} || `;
      return `|-\n${place}{{flagicon|USA}} ${line.player} || ${line.score} || align=center|−1`;
    })
    .join("\n");
  return [
    "==Round summaries==",
    "===Third round===",
    '{|class="wikitable"',
    "!Place!!Player!!Score",
    "|-",
    "|1 || {{flagicon|USA}} [[Somebody Else]] || 70-70-70=210",
    "|}",
    "===Final round===",
    "Prose about Sunday.",
    ...(heading === null ? [] : [`====${heading}====`]),
    '{|class="wikitable"',
    '|-style="background:gold"',
    "|Champion",
    "|-",
    "|(a) = amateur",
    "|}",
    '{|class="wikitable" style="width:40em;margin-bottom:0;"',
    "!Place!!Player!!Score!!To par",
    body,
    "|}",
    "====Scorecard====",
    '{|class="wikitable"',
    "|-",
    "|1 || {{flagicon|USA}} [[Scorecard Only]] || 4-4-4=12",
    "|}",
    "==Notes==",
  ].join("\n");
}

/** Thirty-two lines of a four-round leaderboard, for tests that need a full field. */
export function fieldLines(count = 32): LeaderboardLine[] {
  return Array.from({ length: count }, (_, i) => ({
    place: `${i + 1}`,
    player: `[[Field Player${i + 1}]]`,
    score: "70-70-70-70=280",
  }));
}
