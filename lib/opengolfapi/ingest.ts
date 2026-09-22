// From the schedule's Course names to `courses` rows: match each by name within its state,
// fetch each match, check its holes, map it. Nothing here touches the database, so all of it
// can be tested from fixtures, and nothing is written until every request has been made.

import type { CourseHole, CourseMatch, CourseTee, courses } from "../../db/schema";
import {
  declaredFor,
  implausibleRecord,
  matchCourse,
  matchDeclared,
  scheduledCourses,
  searchQueries,
  stateCode,
  type Candidate,
  type MatchResult,
} from "../courses/match";
import { OPENGOLFAPI_BASE_URL, RateLimitExhausted, type OpenGolfApiClient } from "./client";
import { checkHoles } from "./holes";
import {
  courseResponse,
  searchResponse,
  type CourseResponse,
  type SearchResponse,
} from "./schema";

export function sourceUrl(id: string): string {
  return `${OPENGOLFAPI_BASE_URL}/api/v1/courses/${encodeURIComponent(id)}`;
}

export type CourseRow = typeof courses.$inferInsert;

/** Maps one parsed course, with the attribution its licence requires, to its row. */
export function toCourseRow(course: CourseResponse, attribution: string): CourseRow {
  const tees: CourseTee[] | null =
    course.tees?.map((t) => ({
      name: t.tee_name,
      gender: t.gender,
      par: t.par,
      yardage: t.yardage,
      rating: t.course_rating,
      slope: t.slope,
    })) ?? null;
  const holes: CourseHole[] | null =
    course.holes_data?.map((h) => ({
      number: h.number,
      par: h.par,
      yardages: h.yardages ?? {},
    })) ?? null;
  const check = checkHoles(holes, tees, course.yardage);

  return {
    name: course.course_name,
    openGolfApiId: course.id,
    par: course.par,
    publishedYardage: course.yardage,
    architect: course.architect,
    tees,
    holes,
    holesCheckedTee: check?.tee ?? null,
    holesYardageSum: check?.sum ?? null,
    holesYardageDifference: check?.difference ?? null,
    holesTrusted: check?.trusted ?? null,
    attribution,
    source: "opengolfapi",
    sourceUrl: sourceUrl(course.id),
    derivation: null,
  };
}

/** One Tournament of the season being matched, as `tournaments` stores it. */
export type ScheduledTournament = {
  id: number;
  name: string;
  courseName: string | null;
  location: string | null;
};

/**
 * What became of one schedule Course name. Every one carries the name as the schedule wrote
 * it, so the report lists what is missing in words a person can look up.
 *
 * - `matched`: one OpenGolfAPI course, its name, and how certain the match is.
 * - `near-miss`: search returned courses, and none of them could be chosen with certainty.
 * - `failed`: nothing to choose from, or no way to look: no name, no state, several courses
 *   named with none declared, or a request that failed.
 */
export type Resolution =
  | {
      status: "matched";
      scheduleName: string;
      confidence: CourseMatch;
      openGolfApiId: string;
      openGolfApiName: string;
    }
  | { status: "near-miss"; scheduleName: string; reason: string; candidates: string[] }
  | { status: "failed"; scheduleName: string | null; reason: string };

export type TournamentOutcome = { tournament: ScheduledTournament; resolution: Resolution };

export type CoursePlan = {
  outcomes: TournamentOutcome[];
  /** One row per matched OpenGolfAPI course, however many Tournaments are played on it. */
  rows: CourseRow[];
};

/**
 * The run ran out of requests part way. Nothing has been written, and the message says how
 * far it got, so a re-run tomorrow starts from the same place rather than a half-filled table.
 */
export class RunStopped extends Error {
  constructor(progress: string, cause: RateLimitExhausted) {
    super(`Stopped before writing anything, ${progress}. ${cause.message}`);
    this.name = "RunStopped";
  }
}

const MAX_CANDIDATES_REPORTED = 6;

const described = (c: Candidate) => `${c.course_name} (${c.state ?? "no state"})`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : `${error}`);

type Search = {
  /** Tried in order until one returns anything. */
  queries: string[];
  /** The state to filter search by, or null to search everywhere. */
  state: string | null;
  match: (found: Candidate[], total: number) => MatchResult;
};

/** Requests a search can cost at most: every query, and then its course's record. */
const MAX_QUERIES = 2;
const MAX_REQUESTS_PER_COURSE = MAX_QUERIES + 1;

/** What to search for a schedule name, or why it cannot be searched for. */
function lookupFor(courseName: string, location: string | null): Search | { reason: string } {
  const declared = declaredFor(courseName);
  if (declared) {
    return {
      queries: [declared.query],
      state: declared.state,
      match: (found, total) => matchDeclared(declared, found, total),
    };
  }
  const listed = scheduledCourses(courseName);
  const [host, ...others] = listed;
  if (!host) return { reason: "the schedule's Course name is empty" };
  if (others.length > 0) {
    return {
      reason:
        `it lists ${listed.length} courses (${listed.map((c) => c.name).join("; ")}), ` +
        "and which one the " +
        "Tournament is played on has not been declared",
    };
  }
  if (location === null) {
    return { reason: "the schedule gives no Location to search within" };
  }
  // Abroad, search cannot be filtered by country, so it runs unfiltered and matchCourse
  // accepts only a course with no US state that no other course anywhere reads the same as.
  const state = stateCode(location);
  return {
    queries: searchQueries(host.club).slice(0, MAX_QUERIES),
    state,
    match: (found, total) => matchCourse(host.name, state, found, total),
  };
}

/**
 * Matches every Tournament's Course and fetches every matched course's record: one search per
 * distinct Course name, then one fetch per distinct course. Nothing is stored; the caller
 * writes the plan in one go, or not at all.
 *
 * The requests still needed are checked against what remains before every search, at two per
 * search, and again before the fetches. A run that cannot finish throws RunStopped at the
 * first point it can tell, rather than spending requests on a plan it cannot complete.
 */
export async function planCourses(
  client: OpenGolfApiClient,
  tournaments: readonly ScheduledTournament[],
): Promise<CoursePlan> {
  const resolutions = new Map<string, Resolution>();
  const keyOf = (t: ScheduledTournament) => JSON.stringify([t.courseName, t.location]);

  const searches: { key: string; courseName: string; search: Search }[] = [];
  for (const t of tournaments) {
    const key = keyOf(t);
    if (resolutions.has(key) || searches.some((s) => s.key === key)) continue;
    if (t.courseName === null) {
      resolutions.set(key, {
        status: "failed",
        scheduleName: null,
        reason: "the schedule names no Course",
      });
      continue;
    }
    const lookup = lookupFor(t.courseName, t.location);
    if ("reason" in lookup) {
      resolutions.set(key, {
        status: "failed",
        scheduleName: t.courseName,
        reason: lookup.reason,
      });
    } else {
      searches.push({ key, courseName: t.courseName, search: lookup });
    }
  }

  let attribution: string | null = null;
  let searched = 0;
  try {
    for (const { key, courseName, search } of searches) {
      // The most each search left could cost, this one included.
      client.ensure(MAX_REQUESTS_PER_COURSE * (searches.length - searched));
      try {
        let found: SearchResponse | null = null;
        for (const q of search.queries) {
          const params = new URLSearchParams({ q });
          if (search.state) params.set("state", search.state);
          found = await client.get(`/v1/courses/search?${params}`, searchResponse);
          attribution = found._attribution;
          if (found.courses.length > 0) break;
        }
        const result = search.match(found?.courses ?? [], found?.total ?? 0);
        resolutions.set(
          key,
          result.status === "matched"
            ? {
                status: "matched",
                scheduleName: courseName,
                confidence: result.confidence,
                openGolfApiId: result.course.id,
                openGolfApiName: result.course.course_name,
              }
            : {
                status: "near-miss",
                scheduleName: courseName,
                reason: result.reason,
                candidates: result.candidates.slice(0, MAX_CANDIDATES_REPORTED).map(described),
              },
        );
      } catch (error) {
        if (error instanceof RateLimitExhausted) throw error;
        resolutions.set(key, {
          status: "failed",
          scheduleName: courseName,
          reason: messageOf(error),
        });
      }
      searched += 1;
    }
  } catch (error) {
    if (!(error instanceof RateLimitExhausted)) throw error;
    throw new RunStopped(`having searched for ${searched} of ${searches.length} Courses`, error);
  }

  const ids = [
    ...new Set(
      [...resolutions.values()].flatMap((r) =>
        r.status === "matched" ? [r.openGolfApiId] : [],
      ),
    ),
  ];
  /** A record that cannot be used costs every Tournament matched to it its match. */
  const unmatch = (id: string, why: string) => {
    for (const [key, r] of resolutions) {
      if (r.status === "matched" && r.openGolfApiId === id) {
        resolutions.set(key, {
          status: "failed",
          scheduleName: r.scheduleName,
          reason: `matched "${r.openGolfApiName}" [${r.confidence}], but ${why}`,
        });
      }
    }
  };
  const rows: CourseRow[] = [];
  let fetched = 0;
  try {
    client.ensure(ids.length);
    for (const id of ids) {
      try {
        const course = await client.get(
          `/api/v1/courses/${encodeURIComponent(id)}`,
          courseResponse,
        );
        const implausible = implausibleRecord(course.par, course.yardage);
        if (implausible) {
          unmatch(id, implausible);
        } else {
          // A match exists only after a search succeeded, so attribution has been read.
          rows.push(toCourseRow(course, attribution!));
        }
      } catch (error) {
        if (error instanceof RateLimitExhausted) throw error;
        unmatch(id, `its record could not be read: ${messageOf(error)}`);
      }
      fetched += 1;
    }
  } catch (error) {
    if (!(error instanceof RateLimitExhausted)) throw error;
    throw new RunStopped(
      `having searched for every Course and fetched ${fetched} of ${ids.length} records`,
      error,
    );
  }

  return {
    outcomes: tournaments.map((tournament) => ({
      tournament,
      resolution: resolutions.get(keyOf(tournament))!,
    })),
    rows,
  };
}

