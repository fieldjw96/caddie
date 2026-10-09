// Proves against a real, migrated Postgres that storing a course twice leaves one row, and that
// the database, not the ingest code, holds `holes_trusted` to its arithmetic. Run by
// `npm run test:db`, as source-rule.db.test.ts is.

import { count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { courses, tournaments } from "../../db/schema";
import {
  planTournamentArticleCourse,
  type TournamentCourseOutcome,
} from "../courses/from-tournament";
import augusta from "./fixtures/augusta-national.detail.json";
import { toCourseRow, type CoursePlan, type CourseRow } from "./ingest";
import { courseResponse, parse } from "./schema";
import { storeCourse, storePlan } from "./store";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. The database tests need a migrated Postgres.");
}

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);

// Unique per run, so the tests can share a database with an earlier run of themselves.
const run = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
let counter = 0;

/** Augusta's real row, under an OpenGolfAPI id no real course has. */
function row(overrides: Partial<CourseRow> = {}): CourseRow {
  const base = toCourseRow(parse(courseResponse, augusta, "fixture"), "© A Source");
  return { ...base, openGolfApiId: `${run}-${++counter}`, ...overrides };
}

async function refusal(values: CourseRow): Promise<string> {
  try {
    await db.insert(courses).values(values);
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    if (cause instanceof postgres.PostgresError && cause.constraint_name) {
      return cause.constraint_name;
    }
    throw error;
  }
  throw new Error("courses accepted a row it should have refused");
}

const tournamentIds: number[] = [];

afterAll(async () => {
  if (tournamentIds.length > 0) {
    await db.delete(tournaments).where(inArray(tournaments.id, tournamentIds));
  }
  await client`delete from courses where opengolfapi_id like ${`${run}-%`}`;
  // A Course created from a Tournament's article has no OpenGolfAPI id to be found by.
  await client`delete from courses where name like ${`%${run}%`}`;
  await client.end();
});

describe("storeCourse", () => {
  it("leaves one row however many times the same course is stored", async () => {
    const values = row();
    await storeCourse(db, values);
    await storeCourse(db, { ...values, architect: "Alister MacKenzie" });
    await storeCourse(db, values);

    const stored = await db
      .select()
      .from(courses)
      .where(eq(courses.openGolfApiId, values.openGolfApiId!));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      holesTrusted: false,
      holesYardageDifference: -1080,
      attribution: "© A Source",
      source: "opengolfapi",
    });
    expect(stored[0]?.holes).toHaveLength(18);
    expect(stored[0]?.tees?.[0]).toMatchObject({ name: "Black", rating: 76.2, slope: 148 });
  });
});

describe("courses", () => {
  it("refuses an OpenGolfAPI row with no attribution", async () => {
    expect(await refusal(row({ attribution: null }))).toBe(
      "courses_opengolfapi_is_attributed",
    );
    expect(await refusal(row({ attribution: " " }))).toBe("courses_opengolfapi_is_attributed");
  });

  it("refuses holes_trusted = true for holes 1,080 yards short", async () => {
    expect(await refusal(row({ holesTrusted: true }))).toBe(
      "courses_holes_trusted_is_the_check",
    );
  });

  it("refuses holes_trusted = false for holes within 3%", async () => {
    expect(
      await refusal(
        row({ holesYardageSum: 7300, holesYardageDifference: -145, holesTrusted: false }),
      ),
    ).toBe("courses_holes_trusted_is_the_check");
  });

  it("refuses a verdict without its working", async () => {
    expect(await refusal(row({ holesYardageSum: null }))).toBe(
      "courses_holes_check_is_complete",
    );
    expect(await refusal(row({ holesYardageDifference: -1000 }))).toBe(
      "courses_holes_check_is_complete",
    );
  });
});

describe("storePlan", () => {
  it("links each Tournament to its match, clears one that no longer matches, and re-runs to the same counts", async () => {
    const inserted = await db
      .insert(tournaments)
      .values(
        ["Matched Open", "Unmatched Open"].map((name) => ({
          name: `${name} ${run}`,
          season: 2026,
          startDate: "2026-04-09",
          endDate: "2026-04-12",
          courseName: "Augusta National Golf Club",
          location: "Georgia",
          source: "wikipedia" as const,
          sourceUrl: "https://en.wikipedia.org/wiki/2026_PGA_Tour",
        })),
      )
      .returning({
        id: tournaments.id,
        name: tournaments.name,
        courseName: tournaments.courseName,
        location: tournaments.location,
      });
    tournamentIds.push(...inserted.map((t) => t.id));
    const [matched, unmatched] = inserted;
    const course = row();
    const resolution = {
      status: "matched" as const,
      scheduleName: "Augusta National Golf Club",
      confidence: "exact" as const,
      openGolfApiId: course.openGolfApiId!,
      openGolfApiName: course.name,
    };
    const plan: CoursePlan = {
      outcomes: [
        { tournament: matched!, resolution },
        {
          tournament: unmatched!,
          resolution: { status: "failed", scheduleName: "x", reason: "a test" },
        },
      ],
      rows: [course],
    };

    // The second Tournament starts matched, as a stale match from an earlier run would be.
    const staleCourse = await storeCourse(db, row());
    await db
      .update(tournaments)
      .set({ courseId: staleCourse, courseMatch: "normalised" })
      .where(eq(tournaments.id, unmatched!.id));

    const linked = async () =>
      db
        .select({
          id: tournaments.id,
          courseId: tournaments.courseId,
          match: tournaments.courseMatch,
        })
        .from(tournaments)
        .where(inArray(tournaments.id, tournamentIds))
        .orderBy(tournaments.id);
    const courseCount = async () => (await db.select({ n: count() }).from(courses))[0]!.n;

    await storePlan(db, plan);
    const first = await linked();
    const coursesAfterFirst = await courseCount();
    await storePlan(db, plan);

    expect(first[0]).toMatchObject({ match: "exact", courseId: expect.any(Number) });
    expect(first[1]).toMatchObject({ match: null, courseId: null });
    expect(await linked()).toEqual(first);
    expect(await courseCount()).toBe(coursesAfterFirst);
  });

  it("refuses a course_id that does not say how it was matched", async () => {
    const courseId = await storeCourse(db, row());
    try {
      const [t] = await db
        .insert(tournaments)
        .values({
          name: `Unrecorded ${run}`,
          season: 2026,
          startDate: "2026-04-09",
          endDate: "2026-04-12",
          courseId,
          source: "wikipedia",
          sourceUrl: "https://en.wikipedia.org/wiki/2026_PGA_Tour",
        })
        .returning({ id: tournaments.id });
      tournamentIds.push(t!.id);
      throw new Error("tournaments accepted a course_id with no course_match");
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause ?? error;
      expect(cause).toBeInstanceOf(postgres.PostgresError);
      expect((cause as postgres.PostgresError).constraint_name).toBe(
        "tournaments_course_match_is_recorded",
      );
    }
  });
});

describe("storePlan, for a Course created from the next Tournament's own article", () => {
  /** One Tournament, unmatched by OpenGolfAPI, with the facts its own article stated. */
  async function unmatchedTournament(name: string) {
    const [inserted] = await db
      .insert(tournaments)
      .values({
        name: `${name} ${run}`,
        season: 2026,
        startDate: "2026-10-11",
        endDate: "2026-10-14",
        courseName: `Yokohama Country Club ${run}`,
        coursePar: 71,
        courseYardage: 7315,
        courseArticleUrl: "https://en.wikipedia.org/w/index.php?title=X&oldid=1",
        location: "Japan",
        source: "wikipedia" as const,
        sourceUrl: "https://en.wikipedia.org/wiki/2026_PGA_Tour",
      })
      .returning({
        id: tournaments.id,
        name: tournaments.name,
        startDate: tournaments.startDate,
        courseName: tournaments.courseName,
        coursePar: tournaments.coursePar,
        courseYardage: tournaments.courseYardage,
        courseArticleUrl: tournaments.courseArticleUrl,
      });
    tournamentIds.push(inserted!.id);
    return inserted!;
  }

  const unmatchedPlan = (id: number, name: string): CoursePlan => ({
    outcomes: [
      {
        tournament: { id, name, courseName: null, location: "Japan" },
        resolution: {
          status: "near-miss",
          scheduleName: "Yokohama Country Club",
          reason: "no course outside the US reads as this name",
          candidates: ["YOKOHAMA SPORTS COMPLEX (no state)"],
        },
      },
    ],
    rows: [],
  });

  const linkOf = async (id: number) =>
    (
      await db
        .select({ courseId: tournaments.courseId, match: tournaments.courseMatch })
        .from(tournaments)
        .where(eq(tournaments.id, id))
    )[0]!;

  const namedCourses = async (name: string) =>
    db.select().from(courses).where(eq(courses.name, name));

  it("creates the Course, links the Tournament, and adds no row on a second run", async () => {
    const t = await unmatchedTournament("Baycurrent Classic");
    const plan = unmatchedPlan(t.id, t.name);
    const fromArticle = planTournamentArticleCourse(t);
    expect(fromArticle.status).toBe("created");

    await storePlan(db, plan, fromArticle);
    const first = await linkOf(t.id);
    await storePlan(db, plan, fromArticle);

    const stored = await namedCourses(`Yokohama Country Club ${run}`);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      openGolfApiId: null,
      par: 71,
      publishedYardage: 7315,
      source: "wikipedia",
      holes: null,
      holesTrusted: null,
      tees: null,
    });
    expect(first).toMatchObject({ courseId: stored[0]!.id, match: "tournament_article" });
    expect(await linkOf(t.id)).toEqual(first);
  });

  it("leaves the Course linked when a later run cannot rebuild it", async () => {
    const t = await unmatchedTournament("Baycurrent Classic II");
    const plan = unmatchedPlan(t.id, t.name);
    await storePlan(db, plan, planTournamentArticleCourse(t));
    const linked = await linkOf(t.id);
    expect(linked.match).toBe("tournament_article");

    // The article now states no par: a skip, not a failure, and not a reason to blank the
    // page by clearing a Course an earlier run created from that same article.
    const skipped = planTournamentArticleCourse({ ...t, coursePar: null });
    expect(skipped.status).toBe("skipped");
    await storePlan(db, plan, skipped);

    expect(await linkOf(t.id)).toEqual(linked);
  });

  it("still clears a stale OpenGolfAPI match when the fallback is skipped", async () => {
    const t = await unmatchedTournament("Baycurrent Classic III");
    const staleCourse = await storeCourse(db, row());
    await db
      .update(tournaments)
      .set({ courseId: staleCourse, courseMatch: "normalised" })
      .where(eq(tournaments.id, t.id));

    const skipped: TournamentCourseOutcome = {
      status: "skipped",
      tournamentId: t.id,
      tournamentName: t.name,
      reason: "a test",
    };
    await storePlan(db, unmatchedPlan(t.id, t.name), skipped);

    expect(await linkOf(t.id)).toMatchObject({ courseId: null, match: null });
  });

  it("never updates a Course OpenGolfAPI provided, whatever it is called", async () => {
    const t = await unmatchedTournament("Baycurrent Classic IV");
    const fromOpenGolfApi = row({ name: `Yokohama Country Club ${run}` });
    const openGolfApiId = await storeCourse(db, fromOpenGolfApi);

    await storePlan(db, unmatchedPlan(t.id, t.name), planTournamentArticleCourse(t));

    const stored = await namedCourses(`Yokohama Country Club ${run}`);
    expect(stored).toHaveLength(2);
    expect(stored.filter((c) => c.id === openGolfApiId)[0]).toMatchObject({
      source: "opengolfapi",
      openGolfApiId: fromOpenGolfApi.openGolfApiId,
    });
  });
});
