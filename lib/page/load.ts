// Reads what the page shows out of Postgres, and nothing else. Which Tournament is next is
// decided by the pure `nextTournament`, handed every stored Tournament, rather than by a query
// that would reimplement it; everything else is shaped by lib/page/data.ts.
//
// The database client is imported inside the function rather than at the top: db/client.ts
// refuses to load without DATABASE_URL, and `next build` loads this module while collecting
// routes, when no database is there to talk to.

import "server-only";
import { eq, inArray } from "drizzle-orm";
import {
  courses,
  courseTraits,
  players,
  playerStrengths,
  results,
  tournaments,
  type CourseTee,
} from "../../db/schema";
import { selectRoster } from "../roster";
import { nextTournament } from "../schedule/next-tournament";
import { strengthKey } from "../strengths/store";
import { matchCourse, type CourseView, type PageData, type StrengthView } from "./data";

function championshipTee(tees: CourseTee[] | null, published: number | null) {
  if (!tees || published === null) return null;
  const tee = tees.find((t) => t.yardage === published);
  return tee ? { name: tee.name, slope: tee.slope, rating: tee.rating } : null;
}

/** Everything the page shows, or null when no Tournament is scheduled from `now` onwards. */
export async function loadPageData(now: Date): Promise<PageData | null> {
  const { db } = await import("../../db/client");

  const schedule = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      season: tournaments.season,
      startDate: tournaments.startDate,
      endDate: tournaments.endDate,
      courseName: tournaments.courseName,
      courseId: tournaments.courseId,
      sourceUrl: tournaments.sourceUrl,
    })
    .from(tournaments);
  const next = nextTournament(schedule, now);
  if (next === null) return null;

  const allCourses = await db.select().from(courses);
  const courseRow = matchCourse(next, allCourses);

  const traitRows =
    courseRow === null
      ? []
      : await db
          .select({
            trait: courseTraits.trait,
            value: courseTraits.value,
            unit: courseTraits.unit,
          })
          .from(courseTraits)
          .where(eq(courseTraits.courseId, courseRow.id));

  const venueKey = courseRow === null ? null : strengthKey("venue_record", courseRow.id);
  const keys = ["skill", "form", ...(venueKey === null ? [] : [venueKey])];
  const [playerRows, strengthRows] = await Promise.all([
    db.select({ id: players.id, name: players.name, country: players.country }).from(players),
    db
      .select({
        playerId: playerStrengths.playerId,
        strength: playerStrengths.strength,
        value: playerStrengths.value,
        sampleSize: playerStrengths.sampleSize,
      })
      .from(playerStrengths)
      .where(inArray(playerStrengths.strength, keys)),
  ]);

  const strengths = new Map<string, StrengthView>();
  for (const s of strengthRows) {
    strengths.set(`${s.playerId}|${s.strength}`, { value: s.value, sampleSize: s.sampleSize });
  }
  const get = (id: number, key: string | null) =>
    key === null ? null : (strengths.get(`${id}|${key}`) ?? null);

  const coverageRows = await db
    .select({
      name: tournaments.name,
      season: tournaments.season,
      startDate: tournaments.startDate,
      basis: results.basis,
    })
    .from(results)
    .innerJoin(tournaments, eq(results.tournamentId, tournaments.id))
    .groupBy(tournaments.name, tournaments.season, tournaments.startDate, results.basis)
    .orderBy(tournaments.startDate);

  // An event with any leaderboard row is a leaderboard event: the standings rows of it, where
  // the leaderboard was preferred, are the same finishes read from a worse table.
  const leaderboard = new Set(
    coverageRows.filter((r) => r.basis === "leaderboard").map((r) => r.name),
  );
  const eventNames = (basis: "leaderboard" | "standings") => [
    ...new Set(
      coverageRows
        .filter((r) =>
          basis === "leaderboard" ? leaderboard.has(r.name) : !leaderboard.has(r.name),
        )
        .map((r) => r.name),
    ),
  ];

  const course: CourseView | null =
    courseRow === null
      ? null
      : {
          name: courseRow.name,
          architect: courseRow.architect,
          sourceUrl: courseRow.sourceUrl,
          attribution: courseRow.attribution,
          holesTrusted: courseRow.holesTrusted,
          holesCheckedTee: courseRow.holesCheckedTee,
          holesYardageSum: courseRow.holesYardageSum,
          holesYardageDifference: courseRow.holesYardageDifference,
          publishedYardage: courseRow.publishedYardage,
          championshipTee: championshipTee(courseRow.tees, courseRow.publishedYardage),
          altitude: courseRow.altitude,
          greenSurface: courseRow.greenSurface,
          courseFactsSourceUrl: courseRow.altitudeSourceUrl ?? courseRow.greenSurfaceSourceUrl,
        };

  return {
    tournament: {
      name: next.name,
      season: next.season,
      startDate: next.startDate,
      endDate: next.endDate,
      courseName: next.courseName,
      sourceUrl: next.sourceUrl,
    },
    course,
    traits: Object.fromEntries(
      traitRows.map((t) => [t.trait, { value: t.value, unit: t.unit }]),
    ),
    // By name, so the Players with no record read as a list and a tie in the ranking, which
    // keeps the order it was given, is alphabetical rather than arbitrary.
    players: selectRoster(playerRows)
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map((p) => ({
        id: p.id,
        name: p.name,
        country: p.country,
        skill: get(p.id, "skill"),
        form: get(p.id, "form"),
        venueRecord: get(p.id, venueKey),
      })),
    coverage: {
      seasons: [...new Set(coverageRows.map((r) => r.season))].sort((a, b) => a - b),
      leaderboardEvents: eventNames("leaderboard"),
      standingsEvents: eventNames("standings"),
    },
  };
}
