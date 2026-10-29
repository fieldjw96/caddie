// What the page shows, as plain data, and the pure arithmetic that turns stored rows into it.
// No database, no network, no clock: lib/page/load.ts reads the rows and hands them here, so
// every gap the page discloses is testable against a fixture. See docs/adr/0002 for why the
// gaps are shown rather than hidden: the product's claim is that it shows its working.

import type { Source } from "../../db/schema";
import type { FitCourseTraits, FitTraitName } from "../fit";

/** One Strength as the page shows it: the value, and always the sample it rests on. */
export interface StrengthView {
  /** 0 to 1, or null when the sample is below the minimum: shown as "no record". */
  value: number | null;
  sampleSize: number;
}

/** One Player on the assumed Field, with just what the ranking needs. */
export interface PlayerView {
  id: number;
  name: string;
  country: string | null;
  skill: StrengthView | null;
  consistency: StrengthView | null;
  lowRounds: StrengthView | null;
  /** How the Player has done lately: shown beside the Fit Score, never inside it. */
  form: StrengthView | null;
  /** The record at this Course: shown beside the Fit Score, never inside it. */
  venueRecord: StrengthView | null;
}

export interface TournamentView {
  name: string;
  season: number;
  startDate: string;
  endDate: string;
  /** The venue as the Source writes it, kept even when no Course is matched. */
  courseName: string | null;
  sourceUrl: string | null;
}

/** The stored facts about the Course the page needs, including the working of the hole check. */
export interface CourseView {
  name: string;
  /**
   * Where the Course itself came from: `opengolfapi` for one matched there, `wikipedia` for
   * one created from the Tournament's own article because OpenGolfAPI does not have it. The
   * page says which, because a gap's reason depends on which Source left it.
   */
  source: Source;
  architect: string | null;
  sourceUrl: string | null;
  attribution: string | null;
  holesTrusted: boolean | null;
  holesCheckedTee: string | null;
  holesYardageSum: number | null;
  holesYardageDifference: number | null;
  publishedYardage: number | null;
  /** The tee whose card matches the published total, where one does. */
  championshipTee: { name: string; slope: number | null; rating: number | null } | null;
  /** Feet above sea level, from the Course's own Wikipedia article. Most articles lack it. */
  altitude: number | null;
  /** The putting surface, verbatim from the Course's own Wikipedia article. */
  greenSurface: string | null;
  /** Where altitude and/or green surface were read, whichever is stored. */
  courseFactsSourceUrl: string | null;
}

/** One stored Course Trait, by name. */
export type StoredTraits = Readonly<Record<string, { value: number; unit: string }>>;

/** One Tournament edition: a name alone spans seasons, so the pair is the unit the record counts. */
export interface CoverageEvent {
  name: string;
  season: number;
}

/** Which editions the stored record covers, and from which kind of table. */
export interface CoverageView {
  seasons: number[];
  /** Editions with a full-field leaderboard. */
  leaderboardEvents: CoverageEvent[];
  /** Editions read only from the FedEx Cup standings' top 30 or the playoffs' qualifiers. */
  standingsEvents: CoverageEvent[];
}

/** One stored result row's edition and the table it was read from, grouped by `lib/page/load.ts`. */
export interface CoverageEditionRow {
  name: string;
  season: number;
  basis: "leaderboard" | "standings";
}

/**
 * Classifies each (name, season) edition from its own rows only: an edition with any
 * `leaderboard` row is a leaderboard edition, even when another season's edition of the same
 * Tournament was read only from standings. Order follows first appearance in `rows`, which
 * `lib/page/load.ts` sorts by start date.
 */
export function classifyCoverageEditions(rows: readonly CoverageEditionRow[]): {
  leaderboardEvents: CoverageEvent[];
  standingsEvents: CoverageEvent[];
} {
  const key = (r: { name: string; season: number }) => `${r.name}\u0000${r.season}`;
  const leaderboardKeys = new Set(rows.filter((r) => r.basis === "leaderboard").map(key));
  const leaderboardEvents: CoverageEvent[] = [];
  const standingsEvents: CoverageEvent[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const event: CoverageEvent = { name: r.name, season: r.season };
    if (leaderboardKeys.has(k)) {
      leaderboardEvents.push(event);
    } else {
      standingsEvents.push(event);
    }
  }
  return { leaderboardEvents, standingsEvents };
}

export interface PageData {
  tournament: TournamentView;
  course: CourseView | null;
  traits: StoredTraits;
  players: PlayerView[];
  coverage: CoverageView;
  /** The newest `player_strengths.recorded_at`, as an ISO timestamp, or null when the table is empty. */
  strengthsDerivedAt: string | null;
  /** The newest `results.recorded_at`, as an ISO timestamp, or null when the table is empty. */
  resultsReadAt: string | null;
}

/**
 * The Course a Tournament is played on. The Tournament's own `courseId` where one is stored;
 * otherwise a Course whose name is the Tournament's venue exactly, ignoring case and spacing.
 * Anything looser would be a guess, and a wrong Course would make every number below it wrong,
 * so no match is an answer the page states rather than one it papers over.
 */
export function matchCourse<C extends { id: number; name: string }>(
  tournament: { courseId: number | null; courseName: string | null },
  courses: readonly C[],
): C | null {
  if (tournament.courseId !== null) {
    return courses.find((c) => c.id === tournament.courseId) ?? null;
  }
  if (tournament.courseName === null) return null;
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const wanted = key(tournament.courseName);
  const matches = courses.filter((c) => key(c.name) === wanted);
  return matches.length === 1 ? matches[0]! : null;
}

/** The Course Traits the Fit Score weighs, as the pure `fitScore` wants them. */
export function fitTraits(traits: StoredTraits): FitCourseTraits {
  const pick = (name: FitTraitName) => traits[name]?.value ?? null;
  return {
    length_yards: pick("length_yards"),
    slope_rating_gap: pick("slope_rating_gap"),
    mean_par_4_yards: pick("mean_par_4_yards"),
    longest_par_4_yards: pick("longest_par_4_yards"),
    par_5_share: pick("par_5_share"),
  };
}

/** One line of the Course Profile: a fact, or the reason it is unavailable. Never blank. */
export type ProfileLine =
  | { label: string; value: string; detail?: string }
  | { label: string; value: null; reason: string };

const yards = (n: number) => `${Math.round(n).toLocaleString("en-US")} yards`;

/**
 * Why the Traits built on hole-by-hole data are missing, in words a reader can check: the
 * sum, the published total, and the difference, as lib/opengolfapi/holes.ts found them.
 */
export function holesUnavailableReason(course: CourseView | null): string {
  if (course === null) return "No Course is matched to this Tournament.";
  // A Course OpenGolfAPI does not have at all, read from the Tournament's own Wikipedia
  // article: that article states a published total, never a card, so there is no hole-by-hole
  // data to check rather than some that failed a check. Saying OpenGolfAPI "gave no hole
  // data" would name the wrong Source for the gap.
  if (course.source === "wikipedia") {
    return "Not shown: this Course comes from the Tournament's own Wikipedia article, which states a published total rather than a hole-by-hole card.";
  }
  if (course.holesTrusted === false) {
    const sum = course.holesYardageSum;
    const published = course.publishedYardage;
    const difference = course.holesYardageDifference;
    if (sum !== null && published !== null && difference !== null) {
      const direction = difference < 0 ? "short of" : "over";
      return (
        `Not shown: OpenGolfAPI's hole-by-hole yardages${course.holesCheckedTee ? ` from the ${course.holesCheckedTee} tees` : ""} ` +
        `add up to ${yards(sum)}, ${yards(Math.abs(difference))} ${direction} the published ` +
        `${yards(published)}, so every Trait built on the holes is refused.`
      );
    }
    return "Not shown: OpenGolfAPI's hole-by-hole yardages disagree with the published total, so every Trait built on the holes is refused.";
  }
  if (course.holesTrusted === null) {
    return "Not shown: OpenGolfAPI gave no hole-by-hole data that could be checked against the published total.";
  }
  return "Not shown: not every par 4 carries a yardage at the tees that were checked.";
}

/**
 * Why the par mix and par 5 share are missing: the par check, never the yardage sum, since
 * these two rest on the holes' pars rather than their yardages and are derived whatever
 * `holes_trusted` says.
 */
export function parUnavailableReason(course: CourseView | null): string {
  if (course === null) return "No Course is matched to this Tournament.";
  if (course.source === "wikipedia") {
    return "Not shown: this Course comes from the Tournament's own Wikipedia article, which states a published total rather than a hole-by-hole card.";
  }
  return "Not shown: this Course fails the par check — not exactly 18 holes, each an integer par, summing to the published par — so the par mix is refused.";
}

/**
 * The Course Profile, in the Traits' natural units, in the order a reader asks about a
 * Course. Every line is present whether or not it is known: an unknown Trait says why.
 */
export function courseProfile(course: CourseView | null, traits: StoredTraits): ProfileLine[] {
  const noCourse = "No Course is matched to this Tournament, so none of its facts are held.";
  const holes = holesUnavailableReason(course);
  const parMix = parUnavailableReason(course);
  const courseLevel = course === null ? noCourse : null;
  const t = (name: string) => traits[name]?.value;

  const lines: ProfileLine[] = [];
  const length = t("length_yards");
  const adjustedLength = t("altitude_adjusted_length_yards");
  lines.push(
    length !== undefined
      ? {
          label: "Length",
          value: yards(length),
          detail:
            adjustedLength !== undefined
              ? `published championship total; plays like ${yards(adjustedLength)} adjusted for altitude`
              : "published championship total",
        }
      : {
          label: "Length",
          value: null,
          reason: courseLevel ?? "Not shown: OpenGolfAPI publishes no total yardage.",
        },
  );

  const par = t("par");
  lines.push(
    par !== undefined
      ? { label: "Par", value: String(par) }
      : {
          label: "Par",
          value: null,
          reason: courseLevel ?? "Not shown: no par is published.",
        },
  );

  const threes = t("par_3_count");
  const fours = t("par_4_count");
  const fives = t("par_5_count");
  lines.push(
    threes !== undefined && fours !== undefined && fives !== undefined
      ? {
          label: "Par mix",
          value: `${threes} par 3s, ${fours} par 4s, ${fives} par 5s`,
        }
      : { label: "Par mix", value: null, reason: parMix },
  );

  const share = t("par_5_share");
  lines.push(
    share !== undefined
      ? { label: "Par 5 share", value: `${Math.round(share * 100)}% of holes` }
      : { label: "Par 5 share", value: null, reason: parMix },
  );

  const mean = t("mean_par_4_yards");
  lines.push(
    mean !== undefined
      ? { label: "Mean par 4", value: yards(mean) }
      : { label: "Mean par 4", value: null, reason: holes },
  );

  const longest = t("longest_par_4_yards");
  lines.push(
    longest !== undefined
      ? { label: "Longest par 4", value: yards(longest) }
      : { label: "Longest par 4", value: null, reason: holes },
  );

  const gap = t("slope_rating_gap");
  const tee = course?.championshipTee ?? null;
  lines.push(
    gap !== undefined
      ? {
          label: "Slope against rating",
          value: `${gap.toFixed(1)} points`,
          detail:
            tee !== null && tee.slope !== null && tee.rating !== null
              ? `Slope ${tee.slope} against Course Rating ${tee.rating.toFixed(1)}, ${tee.name} tees`
              : undefined,
        }
      : {
          label: "Slope against rating",
          value: null,
          reason:
            courseLevel ??
            "Not shown: no tee's published card matches the published total, so there is no championship Slope and Rating to read.",
        },
  );

  const altitude = course?.altitude ?? null;
  lines.push(
    altitude !== null
      ? {
          label: "Altitude",
          value: `${altitude.toLocaleString("en-US")} feet above sea level`,
        }
      : {
          label: "Altitude",
          value: null,
          reason:
            courseLevel ??
            "Not shown: no Source we hold has stored this Course's altitude yet.",
        },
  );

  const greenSurface = course?.greenSurface ?? null;
  lines.push(
    greenSurface !== null
      ? { label: "Green surface", value: greenSurface }
      : {
          label: "Green surface",
          value: null,
          reason:
            courseLevel ??
            "Not shown: no Source we hold has stored this Course's green surface yet.",
        },
  );

  if (course?.architect) lines.push({ label: "Architect", value: course.architect });
  return lines;
}

/**
 * The daily ingest (`.github/workflows/ingest.yml`) runs once at 06:17 UTC. Two days lets one
 * missed run pass without the page crying wolf; a `derivedAt` of `null` — no Strength has ever
 * been derived — is stale however recent `now` is.
 */
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/** Whether the newest Strengths derive is too old to trust Form's 180-day window. */
export function isStale(derivedAt: string | null, now: Date): boolean {
  if (derivedAt === null) return true;
  return now.getTime() - new Date(derivedAt).getTime() > STALE_AFTER_MS;
}

/** "28 Oct 2026" in UTC, or "never" for a table that has no row yet. */
export function formatFreshnessDate(iso: string | null): string {
  if (iso === null) return "never";
  const d = new Date(iso);
  const day = d.getUTCDate();
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/** "18–21 September 2026", or across a month where the Tournament spans one. */
export function formatDates(startDate: string, endDate: string): string {
  const parse = (d: string) => new Date(`${d}T00:00:00Z`);
  const start = parse(startDate);
  const end = parse(endDate);
  const month = (d: Date) => d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  const day = (d: Date) => d.getUTCDate();
  const year = (d: Date) => d.getUTCFullYear();
  if (year(start) !== year(end)) {
    return `${day(start)} ${month(start)} ${year(start)} – ${day(end)} ${month(end)} ${year(end)}`;
  }
  if (month(start) !== month(end)) {
    return `${day(start)} ${month(start)} – ${day(end)} ${month(end)} ${year(end)}`;
  }
  return `${day(start)}–${day(end)} ${month(end)} ${year(end)}`;
}

/** A list in prose: "A", "A and B", "A, B and C". */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The results coverage in plain words, one sentence per fact, for the page to print as it is. */
export function coverageSentences(coverage: CoverageView): string[] {
  const { seasons, leaderboardEvents, standingsEvents } = coverage;
  const total = leaderboardEvents.length + standingsEvents.length;
  if (total === 0) {
    return [
      "No results are stored yet, so no Player has a Strength and none has a Fit Score.",
      "Regular tour events would not be covered in any case, because no source we can publish from carries their results.",
    ];
  }
  const season =
    seasons.length === 0
      ? ""
      : ` from the ${listInWords(seasons.map(String))} season${seasons.length > 1 ? "s" : ""}`;
  const sentences = [`The record covers ${total} event${total === 1 ? "" : "s"}${season}.`];
  const named = (events: readonly CoverageEvent[]) =>
    listInWords(events.map((e) => `${e.name} (${e.season})`));
  if (leaderboardEvents.length > 0) {
    sentences.push(
      `Full-field leaderboards, every Player who teed off: ${named(leaderboardEvents)}.`,
    );
  }
  if (standingsEvents.length > 0) {
    sentences.push(
      `Finishes only, from tables that list only Players who had a good season, the top 30 of the FedEx Cup standings or a playoff event's qualifiers: ${named(standingsEvents)}.`,
    );
  }
  sentences.push(
    "Regular tour events are not covered, because no source we can publish from carries their results. A Player whose season was mostly regular events has little or no record here, which says nothing about how good they are.",
  );
  return sentences;
}
