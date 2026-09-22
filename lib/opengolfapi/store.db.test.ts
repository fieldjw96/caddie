// Proves against a real, migrated Postgres that storing a course twice leaves one row, and that
// the database, not the ingest code, holds `holes_trusted` to its arithmetic. Run by
// `npm run test:db`, as source-rule.db.test.ts is.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { courses } from "../../db/schema";
import augusta from "./fixtures/augusta-national.detail.json";
import { toCourseRow, type CourseRow } from "./ingest";
import { courseResponse, parse } from "./schema";
import { storeCourse } from "./store";

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

afterAll(async () => {
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
