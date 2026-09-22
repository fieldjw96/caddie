// Proves against a real, migrated Postgres that storing a course's Traits twice leaves one row
// per Trait, and that a Trait this run did not derive is actually deleted rather than left
// behind from an earlier run. Run by `npm run test:db`, as opengolfapi/store.db.test.ts is.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { courses, courseTraits } from "../db/schema";
import type { DerivedCourseTrait } from "./course-traits";
import { storeCourseTraits } from "./course-traits-store";

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
      attribution: "© A Source",
    })
    .returning({ id: courses.id });
  return row!.id;
}

const trait = (overrides: Partial<DerivedCourseTrait> = {}): DerivedCourseTrait => ({
  trait: "length_yards",
  value: 7200,
  unit: "yards",
  source: "derived",
  sourceUrl: null,
  derivation: "Derived from courses.published_yardage.",
  ...overrides,
});

afterAll(async () => {
  await client`delete from course_traits where course_id in (
    select id from courses where name like ${`${run}-%`}
  )`;
  await client`delete from courses where name like ${`${run}-%`}`;
  await client.end();
});

describe("storeCourseTraits", () => {
  it("leaves one row per Trait however many times the same Traits are stored", async () => {
    const courseId = await makeCourse();
    const traits = [trait(), trait({ trait: "par", value: 72, unit: "strokes" })];

    await storeCourseTraits(db, courseId, traits);
    await storeCourseTraits(db, courseId, [{ ...traits[0]!, value: 7250 }, traits[1]!]);

    const stored = await db
      .select()
      .from(courseTraits)
      .where(eq(courseTraits.courseId, courseId));
    expect(stored).toHaveLength(2);
    expect(stored.find((t) => t.trait === "length_yards")).toMatchObject({ value: 7250 });
  });

  it("deletes a Trait this run does not produce, rather than leaving it behind", async () => {
    const courseId = await makeCourse();
    await storeCourseTraits(db, courseId, [
      trait(),
      trait({ trait: "par_4_count", value: 10, unit: "holes" }),
    ]);

    // A second run, as if holes_trusted had since turned false: only the course-level Trait.
    await storeCourseTraits(db, courseId, [trait()]);

    const stored = await db
      .select()
      .from(courseTraits)
      .where(eq(courseTraits.courseId, courseId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ trait: "length_yards" });
  });

  it("leaves no row when no Trait is derived", async () => {
    const courseId = await makeCourse();
    await storeCourseTraits(db, courseId, [trait()]);
    await storeCourseTraits(db, courseId, []);

    const stored = await db
      .select()
      .from(courseTraits)
      .where(eq(courseTraits.courseId, courseId));
    expect(stored).toHaveLength(0);
  });
});
