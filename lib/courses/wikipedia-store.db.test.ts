// Proves against a real, migrated Postgres that storing a Course's Wikipedia facts is
// idempotent, that a fetch failure leaves an earlier reading alone, and that the database
// itself refuses a fact with no source_url. Run by `npm run test:db`, as
// opengolfapi/store.db.test.ts is.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { courses } from "../../db/schema";
import type { CourseFactsOutcome } from "./wikipedia-ingest";
import { storeCourseFacts } from "./wikipedia-store";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. The database tests need a migrated Postgres.");
}

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);

const run = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
let counter = 0;

async function makeCourse(): Promise<number> {
  const [row] = await db
    .insert(courses)
    .values({
      name: `${run}-${++counter}`,
      source: "opengolfapi",
      sourceUrl: `https://api.opengolfapi.org/api/v1/courses/${run}-${counter}`,
      attribution: "© A Source",
    })
    .returning({ id: courses.id });
  return row!.id;
}

async function refusal(values: Record<string, unknown>): Promise<string> {
  const id = await makeCourse();
  try {
    await db
      .update(courses)
      .set(values)
      .where(eq(courses.id, id));
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    if (cause instanceof postgres.PostgresError && cause.constraint_name) {
      return cause.constraint_name;
    }
    throw error;
  }
  throw new Error("courses accepted a row it should have refused");
}

afterAll(async () => {
  await client`delete from courses where name like ${`${run}-%`}`;
  await client.end();
});

describe("storeCourseFacts", () => {
  it("writes both facts and their shared source_url", async () => {
    const id = await makeCourse();
    const outcome: CourseFactsOutcome = {
      status: "read",
      courseId: id,
      name: "Test Course",
      altitudeFeet: 235,
      greenSurface: "Bentgrass",
      sourceUrl: "https://en.wikipedia.org/w/index.php?title=Test_Course&oldid=1",
    };

    await storeCourseFacts(db, outcome);
    await storeCourseFacts(db, outcome);

    const [stored] = await db.select().from(courses).where(eq(courses.id, id));
    expect(stored).toMatchObject({
      altitude: 235,
      altitudeSourceUrl: outcome.sourceUrl,
      greenSurface: "Bentgrass",
      greenSurfaceSourceUrl: outcome.sourceUrl,
    });
  });

  it("stores each fact null, with no source_url, when the article carries neither", async () => {
    const id = await makeCourse();
    await storeCourseFacts(db, {
      status: "read",
      courseId: id,
      name: "Test Course",
      altitudeFeet: null,
      greenSurface: null,
      sourceUrl: "https://en.wikipedia.org/w/index.php?title=Test_Course&oldid=2",
    });

    const [stored] = await db.select().from(courses).where(eq(courses.id, id));
    expect(stored).toMatchObject({
      altitude: null,
      altitudeSourceUrl: null,
      greenSurface: null,
      greenSurfaceSourceUrl: null,
    });
  });

  it("leaves an earlier reading alone when this run could not read the article", async () => {
    const id = await makeCourse();
    await storeCourseFacts(db, {
      status: "read",
      courseId: id,
      name: "Test Course",
      altitudeFeet: 400,
      greenSurface: "Bermuda",
      sourceUrl: "https://en.wikipedia.org/w/index.php?title=Test_Course&oldid=3",
    });

    await storeCourseFacts(db, {
      status: "no-article",
      courseId: id,
      name: "Test Course",
      reason: "network trouble",
    });

    const [stored] = await db.select().from(courses).where(eq(courses.id, id));
    expect(stored).toMatchObject({ altitude: 400, greenSurface: "Bermuda" });
  });
});

describe("courses", () => {
  it("refuses an altitude with no source_url", async () => {
    expect(await refusal({ altitude: 235 })).toBe("courses_altitude_source_is_recorded");
  });

  it("refuses a source_url with no altitude", async () => {
    expect(
      await refusal({ altitudeSourceUrl: "https://en.wikipedia.org/wiki/Test_Course" }),
    ).toBe("courses_altitude_source_is_recorded");
  });

  it("refuses a green surface with no source_url", async () => {
    expect(await refusal({ greenSurface: "Bentgrass" })).toBe(
      "courses_green_surface_source_is_recorded",
    );
  });

  it("refuses a blank green surface even with a source_url", async () => {
    expect(
      await refusal({
        greenSurface: " ",
        greenSurfaceSourceUrl: "https://en.wikipedia.org/wiki/Test_Course",
      }),
    ).toBe("courses_green_surface_source_is_recorded");
  });
});
