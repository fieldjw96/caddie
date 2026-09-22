// Matching a Tournament's Course, as the schedule writes it, to one OpenGolfAPI course. Pure:
// it takes what the schedule said and what a search returned, and says what matched and how
// certainly. Nothing here fetches anything, so every rule is tested from fixtures.
//
// A wrong match is worse than no match, because nothing downstream can detect one: the page
// would print another course's Profile under this Tournament's name. So every rule here
// refuses rather than guesses, and every refusal says why, so a person can decide.

import type { CourseMatch } from "../../db/schema";

/** Two-letter codes, as OpenGolfAPI's `state` field writes them, by the schedule's name. */
const US_STATES: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
  "Puerto Rico": "PR",
};

/**
 * The state a schedule Location names, or null for a country or anything unrecognised. A
 * Tournament with no state is not searched for: a name alone, across every course in the
 * country, is too easy to match to the wrong one.
 */
export function stateCode(location: string | null): string | null {
  if (location === null) return null;
  return US_STATES[location.trim()] ?? null;
}

/**
 * The courses a schedule's `course_name` lists, each as one name. The schedule writes a
 * club, then the course played there in parentheses, and several of those for an event
 * played over more than one course:
 *
 *   "TPC Sawgrass, (Stadium Course)"            -> ["TPC Sawgrass Stadium Course"]
 *   "Torrey Pines Golf Course, (South Course), (North Course)"
 *     -> ["Torrey Pines Golf Course South Course", "Torrey Pines Golf Course North Course"]
 *   "{{nowrap|Pebble Beach Golf Links, Spyglass Hill Golf Course}}"
 *     -> ["Pebble Beach Golf Links", "Spyglass Hill Golf Course"]
 */
export function scheduledCourses(courseName: string): string[] {
  const text = courseName
    .replace(/\{\{\s*[^{}|]*\|([^{}]*)\}\}/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const found: string[] = [];
  let club: string | null = null;
  let clubHasCourse = false;
  const closeClub = () => {
    if (club !== null && !clubHasCourse) found.push(club);
  };
  for (const part of text.split(",").map((p) => p.trim())) {
    if (part === "") continue;
    const alone = /^\((.+)\)$/.exec(part);
    if (alone && club !== null) {
      found.push(`${club} ${alone[1]!.trim()}`);
      clubHasCourse = true;
      continue;
    }
    closeClub();
    const inline = /^(.+?)\s*\((.+)\)$/.exec(part);
    if (inline) {
      club = inline[1]!.trim();
      found.push(`${club} ${inline[2]!.trim()}`);
      clubHasCourse = true;
    } else {
      club = part;
      clubHasCourse = false;
    }
  }
  closeClub();
  return found;
}

/** Case, accents and punctuation ignored; `&` read as "and". Word order is kept. */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Words that say what kind of place a course is rather than which one. Dropping them is what
 * lets "Riviera Country Club" read the same as "The Riviera Country Club", and no more than
 * that: what is left must still be equal, word for word, in order.
 */
const GENERIC_WORDS = new Set([
  "the",
  "and",
  "at",
  "of",
  "golf",
  "club",
  "country",
  "course",
  "links",
  "resort",
  "spa",
]);

/** The words that identify a course, in order, once the generic ones are dropped. */
export function distinctiveWords(name: string): string[] {
  return normaliseName(name)
    .split(" ")
    .filter((word) => word !== "" && !GENERIC_WORDS.has(word));
}

/**
 * What to search for. OpenGolfAPI's search matches a contiguous run of characters in the
 * course's name, so the query is short: the first two distinctive words. The full name is
 * compared afterwards, and the state filter keeps the results few.
 */
export function searchQuery(name: string): string {
  const words = distinctiveWords(name);
  return (words.length > 0 ? words : normaliseName(name).split(" ")).slice(0, 2).join(" ");
}

/**
 * A pairing a person made by reading both names, for a schedule name normalising cannot
 * settle: OpenGolfAPI calls Bay Hill "Bay Hill Club Lodge Championship Course", and the
 * schedule "Bay Hill Club and Lodge". Each is checked against the search like any other match,
 * by exact name and state, so a declaration cannot point at a course that is not there.
 */
export type Declared = {
  /** The schedule's `course_name`, exactly as `ingest:schedule` stores it. */
  schedule: string;
  query: string;
  /** OpenGolfAPI's `course_name` for the right result. */
  name: string;
  state: string;
};

/**
 * Every declared pairing. Add one only after reading OpenGolfAPI's record and being sure it is
 * the course the Tournament is played on; for an event played over several courses, it is the
 * one the final round is played on.
 */
export const DECLARED_MATCHES: readonly Declared[] = [];

export function declaredFor(courseName: string): Declared | undefined {
  return DECLARED_MATCHES.find((d) => d.schedule === courseName);
}

/** One course as search returned it, reduced to what matching reads. */
export type Candidate = { id: string; course_name: string; state: string | null };

export type MatchResult =
  | { status: "matched"; confidence: CourseMatch; course: Candidate }
  | { status: "near-miss"; reason: string; candidates: Candidate[] };

const sameState = (state: string) => (c: Candidate) => c.state === state;

/** Exactly one of `found`, or the reason there was not. */
function one(
  found: Candidate[],
  confidence: CourseMatch,
  all: Candidate[],
): MatchResult | null {
  if (found.length === 1) return { status: "matched", confidence, course: found[0]! };
  if (found.length > 1) {
    return {
      status: "near-miss",
      reason: `${found.length} courses in the state read as this name, so none is chosen`,
      candidates: all,
    };
  }
  return null;
}

/**
 * The one candidate `name` matches in `state`, and how certainly, or a near-miss saying why
 * not. Two courses reading the same is a near-miss, not a coin toss.
 */
export function matchCourse(name: string, state: string, candidates: Candidate[]): MatchResult {
  const inState = candidates.filter(sameState(state));
  const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

  const exact = one(
    inState.filter((c) => collapse(c.course_name) === collapse(name)),
    "exact",
    candidates,
  );
  if (exact) return exact;

  const words = distinctiveWords(name).join(" ");
  const normalised = one(
    inState.filter((c) => distinctiveWords(c.course_name).join(" ") === words),
    "normalised",
    candidates,
  );
  if (normalised) return normalised;

  return {
    status: "near-miss",
    reason:
      candidates.length === 0
        ? `search for "${searchQuery(name)}" in ${state} returned nothing`
        : `no course in ${state} reads as this name`,
    candidates,
  };
}

/** The declared course among `candidates`, by its exact name and state, or why not. */
export function matchDeclared(declared: Declared, candidates: Candidate[]): MatchResult {
  const collapse = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const found = candidates.filter(
    (c) => collapse(c.course_name) === collapse(declared.name) && c.state === declared.state,
  );
  return (
    one(found, "declared", candidates) ?? {
      status: "near-miss",
      reason: `the declared course "${declared.name}" (${declared.state}) was not in the search`,
      candidates,
    }
  );
}
