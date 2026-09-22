// From a course's name to a `courses` row: resolve it, fetch it, check its holes, map it.
// Nothing here touches the database, so all of it can be tested from fixtures.

import type { CourseHole, CourseTee, courses } from "@/db/schema";
import { OPENGOLFAPI_BASE_URL, type OpenGolfApiClient } from "./client";
import { checkHoles } from "./holes";
import { courseResponse, searchResponse, type CourseResponse } from "./schema";

/**
 * A course to resolve by name. Search is fuzzy and returns neighbours: "Bay Hill" finds six
 * courses in four states, "Riviera" ten. So a Venue names the query, and then the exact name
 * and state the right result must have. Resolution accepts exactly one match and refuses
 * anything else, rather than guessing.
 */
export type Venue = {
  /** The query sent to search. */
  query: string;
  /** OpenGolfAPI's `course_name` for the right result, compared ignoring case and spacing. */
  name: string;
  /** Two-letter state, sent as a filter and checked on the result. */
  state?: string;
};

/**
 * The PGA venues this Ticket was written against. Where a club has several courses, this is
 * the one the Tour plays: the Stadium courses at Sawgrass and Scottsdale, the South at Torrey
 * Pines, the Championship at Bay Hill.
 */
export const VENUES: Venue[] = [
  { query: "Augusta National", name: "Augusta National Golf Club", state: "GA" },
  { query: "TPC Sawgrass", name: "Tpc Sawgrass The Players Stadium Course", state: "FL" },
  { query: "Pebble Beach", name: "Pebble Beach Golf Links", state: "CA" },
  { query: "Torrey Pines", name: "Torrey Pines South Course", state: "CA" },
  { query: "Bay Hill", name: "Bay Hill Club Lodge Championship Course", state: "FL" },
  { query: "Muirfield Village", name: "Muirfield Village Golf Club", state: "OH" },
  { query: "TPC Scottsdale", name: "Tpc Scottsdale The Stadium Course", state: "AZ" },
  { query: "Riviera", name: "The Riviera Country Club", state: "CA" },
];

/** A course that could not be resolved to exactly one OpenGolfAPI record. */
export class ResolutionError extends Error {
  constructor(venue: Venue, detail: string) {
    super(`"${venue.query}" did not resolve to one course named "${venue.name}": ${detail}`);
    this.name = "ResolutionError";
  }
}

const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export type Resolved = { id: string; attribution: string };

export async function resolve(client: OpenGolfApiClient, venue: Venue): Promise<Resolved> {
  const params = new URLSearchParams({ q: venue.query });
  if (venue.state) params.set("state", venue.state);
  const found = await client.get(`/v1/courses/search?${params}`, searchResponse);

  const matches = found.courses.filter(
    (c) =>
      normalise(c.course_name) === normalise(venue.name) &&
      (venue.state === undefined || c.state === venue.state),
  );
  const [match, ...others] = matches;
  if (!match) {
    const names = found.courses.map((c) => `${c.course_name} (${c.state ?? "no state"})`);
    throw new ResolutionError(venue, `search returned ${names.join(", ") || "nothing"}`);
  }
  if (others.length > 0) {
    throw new ResolutionError(venue, `${matches.length} courses share that name and state`);
  }
  return { id: match.id, attribution: found._attribution };
}

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

/** Resolves one Venue and fetches its full record: two requests. */
export async function fetchCourse(client: OpenGolfApiClient, venue: Venue): Promise<CourseRow> {
  const { id, attribution } = await resolve(client, venue);
  const course = await client.get(
    `/api/v1/courses/${encodeURIComponent(id)}`,
    courseResponse,
  );
  return toCourseRow(course, attribution);
}
