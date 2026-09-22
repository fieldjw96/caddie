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
 * The state a schedule Location names, or null for a country. Search is filtered to the
 * state, so a US course is only ever matched among the courses of its own state.
 */
export function stateCode(location: string | null): string | null {
  if (location === null) return null;
  return US_STATES[location.trim()] ?? null;
}

/** One course a schedule lists: the club, and the name of the course played there. */
export type ScheduledCourse = {
  /** The club alone, as written: what search is sent. */
  club: string;
  /** The club and its course together, as matched: "TPC Sawgrass Stadium Course". */
  name: string;
};

/**
 * The courses a schedule's `course_name` lists. The schedule writes a club, then the course
 * played there in parentheses, and several of those for an event played over more than one
 * course:
 *
 *   "TPC Sawgrass, (Stadium Course)"            -> TPC Sawgrass Stadium Course
 *   "Torrey Pines Golf Course, (South Course), (North Course)"
 *     -> Torrey Pines Golf Course South Course, Torrey Pines Golf Course North Course
 *   "{{nowrap|Pebble Beach Golf Links, Spyglass Hill Golf Course}}"
 *     -> Pebble Beach Golf Links, Spyglass Hill Golf Course
 */
export function scheduledCourses(courseName: string): ScheduledCourse[] {
  const text = courseName
    .replace(/\{\{\s*[^{}|]*\|([^{}]*)\}\}/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const found: ScheduledCourse[] = [];
  let club: string | null = null;
  let clubHasCourse = false;
  const closeClub = () => {
    if (club !== null && !clubHasCourse) found.push({ club, name: club });
  };
  const addCourse = (clubName: string, course: string) => {
    found.push({ club: clubName, name: `${clubName} ${course.trim()}` });
    clubHasCourse = true;
  };
  for (const part of text.split(",").map((p) => p.trim())) {
    if (part === "") continue;
    const alone = /^\((.+)\)$/.exec(part);
    if (alone && club !== null) {
      addCourse(club, alone[1]!);
      continue;
    }
    closeClub();
    const inline = /^(.+?)\s*\((.+)\)$/.exec(part);
    club = inline ? inline[1]!.trim() : part;
    clubHasCourse = false;
    if (inline) addCourse(club, inline[2]!);
  }
  closeClub();
  return found;
}

/** Case, accents and punctuation ignored; `&` read as "and". Word order is kept. */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
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
  "municipal",
]);

/** The words that identify a course, in order, once the generic ones are dropped. */
export function distinctiveWords(name: string): string[] {
  return normaliseName(name)
    .split(" ")
    .filter((word) => word !== "" && !GENERIC_WORDS.has(word));
}

/**
 * What to search for, in order: the first two distinctive words of the club, then the first
 * alone if two found nothing. OpenGolfAPI's search matches a contiguous run of characters in
 * a course's name, so a short query finds "The Dunes Golf Beach Club" where the schedule's
 * "Dunes Golf and Beach Club" would not. The full name is compared afterwards, within the
 * state, so a broad query costs nothing in certainty.
 */
export function searchQueries(club: string): string[] {
  const words = distinctiveWords(club);
  const usable = words.length > 0 ? words : normaliseName(club).split(" ");
  return [...new Set([usable.slice(0, 2).join(" "), usable[0] ?? ""])].filter((q) => q !== "");
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
 * one the final round is played on. A club whose record could be either of two courses, such
 * as Detroit Golf Club's single record for its North and South, is left undeclared.
 */
export const DECLARED_MATCHES: readonly Declared[] = [
  // Several courses listed: the one the final round is played on.
  {
    schedule:
      "La Quinta Country Club, PGA West, (Stadium Course), (Nicklaus Tournament Course)",
    query: "pga west",
    name: "The Stadium Course At Pga West",
    state: "CA",
  },
  {
    schedule: "Torrey Pines Golf Course, (South Course), (North Course)",
    query: "torrey pines",
    name: "Torrey Pines South Course",
    state: "CA",
  },
  {
    schedule: "{{nowrap|Pebble Beach Golf Links, Spyglass Hill Golf Course}}",
    query: "pebble beach",
    name: "Pebble Beach Golf Links",
    state: "CA",
  },
  {
    schedule: "Sea Island Golf Club, (Seaside Course), (Plantation Course)",
    query: "sea island",
    name: "Seaside At Sea Island Golf Club",
    state: "GA",
  },
  // One course, named by OpenGolfAPI in words normalising cannot reach, beside a sibling
  // course at the same club it must not be confused with.
  {
    schedule: "TPC Scottsdale",
    query: "tpc scottsdale",
    name: "Tpc Scottsdale The Stadium Course",
    state: "AZ",
  },
  {
    schedule: "Bay Hill Club and Lodge",
    query: "bay hill",
    name: "Bay Hill Club Lodge Championship Course",
    state: "FL",
  },
  {
    schedule: "TPC Sawgrass, (Stadium Course)",
    query: "tpc sawgrass",
    name: "Tpc Sawgrass The Players Stadium Course",
    state: "FL",
  },
  // Two records in Charlotte read as "Quail Hollow". This one is the Tour course by its own
  // card: 7,635 yards at par 71, rated 77.3 with a slope of 148. The other, "Quail Hollow
  // Golf Club", is 6,325 yards at par 70.
  {
    schedule: "Quail Hollow Club",
    query: "quail hollow",
    name: "Quail Hollow Country Club",
    state: "NC",
  },
  {
    schedule: "Trump National Doral, (Blue Monster)",
    query: "doral",
    name: "Trump National Doral Miami Blue Monster Course",
    state: "FL",
  },
];

export function declaredFor(courseName: string): Declared | undefined {
  return DECLARED_MATCHES.find((d) => d.schedule === courseName);
}

/** One course as search returned it, reduced to what matching reads. */
export type Candidate = { id: string; course_name: string; state: string | null };

export type MatchResult =
  | { status: "matched"; confidence: CourseMatch; course: Candidate }
  | { status: "near-miss"; reason: string; candidates: Candidate[] };

/**
 * Search returns at most one page. A name that appears once on a page that is not the whole
 * result might appear again on the next, so uniqueness cannot be claimed from it.
 */
function truncation(candidates: Candidate[], total: number): MatchResult | null {
  if (total <= candidates.length) return null;
  return {
    status: "near-miss",
    reason: `search returned ${candidates.length} of ${total} results, too few to be sure of one`,
    candidates,
  };
}

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

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * The one candidate `name` matches, and how certainly, or a near-miss saying why not.
 *
 * `state` is where the course must be: a US state, or null for a Tournament played abroad,
 * whose course OpenGolfAPI records with no state. Every candidate that reads as `name` is
 * counted wherever it is, and there must be exactly one, in the right place: two courses
 * reading the same is a near-miss, not a coin toss, and so is the only one being elsewhere.
 * `total` is how many results search said it had, of which `candidates` is the page returned.
 */
export function matchCourse(
  name: string,
  state: string | null,
  candidates: Candidate[],
  total: number = candidates.length,
): MatchResult {
  const truncated = truncation(candidates, total);
  if (truncated) return truncated;
  const where = state ?? "outside the US";

  const tiers: [CourseMatch, (c: Candidate) => boolean][] = [
    ["exact", (c) => collapse(c.course_name) === collapse(name)],
    [
      "normalised",
      (c) => distinctiveWords(c.course_name).join(" ") === distinctiveWords(name).join(" "),
    ],
  ];
  for (const [confidence, reads] of tiers) {
    const found = candidates.filter(reads);
    const [only] = found;
    if (found.length > 1) {
      return {
        status: "near-miss",
        reason: `${found.length} courses read as this name, so none is chosen`,
        candidates,
      };
    }
    if (only && only.state !== state) {
      return {
        status: "near-miss",
        reason: `the one course that reads as this name is ${only.state ? `in ${only.state}` : "outside the US"}, not ${where}`,
        candidates,
      };
    }
    if (only) return { status: "matched", confidence, course: only };
  }

  return {
    status: "near-miss",
    reason:
      candidates.length === 0
        ? `search in ${where} returned nothing`
        : `no course in ${where} reads as this name`,
    candidates,
  };
}

/** The declared course among `candidates`, by its exact name and state, or why not. */
export function matchDeclared(
  declared: Declared,
  candidates: Candidate[],
  total: number = candidates.length,
): MatchResult {
  const truncated = truncation(candidates, total);
  if (truncated) return truncated;
  const lower = (s: string) => collapse(s).toLowerCase();
  const found = candidates.filter(
    (c) => lower(c.course_name) === lower(declared.name) && c.state === declared.state,
  );
  return (
    one(found, "declared", candidates) ?? {
      status: "near-miss",
      reason: `the declared course "${declared.name}" (${declared.state}) was not in the search`,
      candidates,
    }
  );
}

/** The par a Tour course is played at, from a par-3 heavy 68 to a par-5 heavy 73. */
const TOUR_PAR = { min: 68, max: 73 };

/**
 * No course the Tour plays is shorter than this: the shortest, such as Harbour Town, are
 * around 7,100 yards from the back. This sits well below them, so it catches only a record
 * that is of something else, not a short course.
 */
const TOUR_MINIMUM_YARDAGE = 6_500;

/**
 * Why a matched course's record cannot be the course a Tournament is played on, or null if
 * nothing rules it out. OpenGolfAPI's Colonial Country Club, Fort Worth, is par 58 and 2,194
 * yards: the right club, and a record of something else there. Its name matched exactly, so
 * nothing but the record itself can catch it.
 */
export function implausibleRecord(par: number | null, yardage: number | null): string | null {
  if (par !== null && (par < TOUR_PAR.min || par > TOUR_PAR.max)) {
    return `its record is par ${par}, which no Tour course is`;
  }
  if (yardage !== null && yardage < TOUR_MINIMUM_YARDAGE) {
    return `its record is ${yardage} yards, shorter than any Tour course`;
  }
  return null;
}
