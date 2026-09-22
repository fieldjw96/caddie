// What the page shows, as plain data, and the pure arithmetic that turns stored rows into it.
// No database, no network, no clock: lib/page/load.ts reads the rows and hands them here, so
// every gap the page discloses is testable against a fixture. See docs/adr/0002 for why the
// gaps are shown rather than hidden: the product's claim is that it shows its working.

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
}

/** One stored Course Trait, by name. */
export type StoredTraits = Readonly<Record<string, { value: number; unit: string }>>;

/** Which events the stored record covers, and from which kind of table. */
export interface CoverageView {
  seasons: number[];
  /** Events with a full-field leaderboard. */
  leaderboardEvents: string[];
  /** Events read only from the FedEx Cup standings table's top 30. */
  standingsEvents: string[];
}

export interface PageData {
  tournament: TournamentView;
  course: CourseView | null;
  traits: StoredTraits;
  players: PlayerView[];
  coverage: CoverageView;
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
 * The Course Profile, in the Traits' natural units, in the order a reader asks about a
 * Course. Every line is present whether or not it is known: an unknown Trait says why.
 */
export function courseProfile(course: CourseView | null, traits: StoredTraits): ProfileLine[] {
  const noCourse = "No Course is matched to this Tournament, so none of its facts are held.";
  const holes = holesUnavailableReason(course);
  const courseLevel = course === null ? noCourse : null;
  const t = (name: string) => traits[name]?.value;

  const lines: ProfileLine[] = [];
  const length = t("length_yards");
  lines.push(
    length !== undefined
      ? { label: "Length", value: yards(length), detail: "published championship total" }
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
      : { label: "Par mix", value: null, reason: holes },
  );

  const share = t("par_5_share");
  lines.push(
    share !== undefined
      ? { label: "Par 5 share", value: `${Math.round(share * 100)}% of holes` }
      : { label: "Par 5 share", value: null, reason: holes },
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

  lines.push({
    label: "Altitude",
    value: null,
    reason: "Not shown: no Source we hold has stored this Course's altitude yet.",
  });

  if (course?.architect) lines.push({ label: "Architect", value: course.architect });
  return lines;
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
  if (leaderboardEvents.length > 0) {
    sentences.push(
      `Full-field leaderboards, every Player who teed off: ${listInWords(leaderboardEvents)}.`,
    );
  }
  if (standingsEvents.length > 0) {
    sentences.push(
      `Only the top 30 of the FedEx Cup standings, so only the finishes of Players who had a good season: ${listInWords(standingsEvents)}.`,
    );
  }
  sentences.push(
    "Regular tour events are not covered, because no source we can publish from carries their results. A Player whose season was mostly regular events has little or no record here, which says nothing about how good they are.",
  );
  return sentences;
}
