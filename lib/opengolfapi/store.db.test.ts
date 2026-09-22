// Proves against a real, migrated Postgres that storing a course twice leaves one row, and that
// the database, not the ingest code, holds `holes_trusted` to its arithmetic. Run by
// `npm run test:db`, as source-rule.db.test.ts is.

import { count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { courses, tournaments } from "../../db/schema";
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
