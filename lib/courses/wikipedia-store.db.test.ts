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
    await db.update(courses).set(values).where(eq(courses.id, id));
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
      altitudeSource: "wikipedia",
      altitudeSourceUrl: outcome.sourceUrl,
      greenSurface: "Bentgrass",
      greenSurfaceSource: "wikipedia",
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
      altitudeSource: null,
      altitudeSourceUrl: null,
      greenSurface: null,
      greenSurfaceSource: null,
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

describe("an altitude from the elevation model", () => {
  const model = {
    altitude: 174,
    altitudeSource: "copernicus" as const,
    altitudeSourceUrl: "https://api.open-meteo.com/v1/elevation?latitude=1&longitude=2",
  };
  const read = (id: number, altitudeFeet: number | null): CourseFactsOutcome => ({
    status: "read",
    courseId: id,
    name: "Test Course",
    altitudeFeet,
    greenSurface: null,
    sourceUrl: "https://en.wikipedia.org/w/index.php?title=Test_Course&oldid=9",
  });

  it("survives an article that states no altitude", async () => {
    const id = await makeCourse();
    await db.update(courses).set(model).where(eq(courses.id, id));

    await storeCourseFacts(db, read(id, null));

    const [stored] = await db.select().from(courses).where(eq(courses.id, id));
    expect(stored).toMatchObject(model);
  });

  it("gives way to an article that states one", async () => {
    const id = await makeCourse();
    await db.update(courses).set(model).where(eq(courses.id, id));

    await storeCourseFacts(db, read(id, 200));

    const [stored] = await db.select().from(courses).where(eq(courses.id, id));
    expect(stored).toMatchObject({ altitude: 200, altitudeSource: "wikipedia" });
  });
});

describe("cards and coordinates from elsewhere", () => {
  const holes = [{ number: 1, par: 4, yardages: {} }];
  const url = "https://www.openstreetmap.org/way/1";

  const accepted = async (values: Record<string, unknown>) => {
    const id = await makeCourse();
    await db.update(courses).set(values).where(eq(courses.id, id));
    const [stored] = await db.select().from(courses).where(eq(courses.id, id));
    return stored;
  };

  it("stores a card that names where it came from", async () => {
    for (const holesSource of ["openstreetmap", "declared"]) {
      const stored = await accepted({ holes, holesSource, holesSourceUrl: url });
      expect(stored?.holesSource).toBe(holesSource);
    }
  });

  it("refuses a card with no url, no Source, or a Source that may not supply one", async () => {
    const name = "courses_holes_source_is_recorded";
    expect(await refusal({ holes, holesSource: "declared" })).toBe(name);
    expect(await refusal({ holes, holesSourceUrl: url })).toBe(name);
    expect(await refusal({ holes, holesSource: "wikipedia", holesSourceUrl: url })).toBe(name);
    expect(await refusal({ holesSource: "declared", holesSourceUrl: url })).toBe(name);
  });

  it("refuses coordinates that are partial, unsourced or impossible", async () => {
    const name = "courses_coordinates_source_is_recorded";
    const good = {
      latitude: 22.9,
      longitude: -109.98,
      coordinatesSource: "openstreetmap",
      coordinatesSourceUrl: url,
    };
    expect((await accepted(good))?.latitude).toBe(22.9);
    expect(await refusal({ ...good, longitude: undefined })).toBe(name);
    expect(await refusal({ ...good, coordinatesSource: undefined })).toBe(name);
    expect(await refusal({ ...good, coordinatesSourceUrl: undefined })).toBe(name);
    expect(await refusal({ ...good, latitude: 91 })).toBe(name);
    expect(await refusal({ ...good, coordinatesSource: "wikipedia" })).toBe(name);
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

  it("refuses an altitude with a source_url but no source", async () => {
    expect(
      await refusal({
        altitude: 235,
        altitudeSourceUrl: "https://en.wikipedia.org/wiki/Test_Course",
      }),
    ).toBe("courses_altitude_source_is_recorded");
  });

  it("refuses an altitude from a Source that may not supply one", async () => {
    expect(
      await refusal({
        altitude: 235,
        altitudeSource: "opengolfapi",
        altitudeSourceUrl: "https://en.wikipedia.org/wiki/Test_Course",
      }),
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

  it("refuses a green surface with a source_url but no source", async () => {
    expect(
      await refusal({
        greenSurface: "Bentgrass",
        greenSurfaceSourceUrl: "https://en.wikipedia.org/wiki/Test_Course",
      }),
    ).toBe("courses_green_surface_source_is_recorded");
  });

  it("refuses a green surface whose source isn't wikipedia", async () => {
    expect(
      await refusal({
        greenSurface: "Bentgrass",
        greenSurfaceSource: "opengolfapi",
        greenSurfaceSourceUrl: "https://en.wikipedia.org/wiki/Test_Course",
      }),
    ).toBe("courses_green_surface_source_is_recorded");
  });
});
