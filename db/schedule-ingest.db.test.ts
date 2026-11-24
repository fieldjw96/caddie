// Proves against a real, migrated Postgres that re-running the ingest is idempotent: the same
// records, upserted twice, leave the same number of rows rather than duplicating them. See
// db/source-rule.db.test.ts for why this lives here rather than under `npm run test`.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { upsertTournaments, type TournamentRecord } from "../lib/schedule/ingest";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. The database tests need a migrated Postgres.");
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

// Unique per run, so the season doesn't collide with an earlier run of these tests, or with
// source-rule.db.test.ts's own fixtures sharing the database.
const season = 190000 + Math.floor(Math.random() * 9000);

const records: TournamentRecord[] = [
  {
    name: "Test Open",
    season,
    startDate: "2026-01-18",
    endDate: "2026-01-21",
    courseName: "Test Country Club",
    coursePar: 70,
    courseYardage: 7044,
    courseArticleUrl: "https://en.wikipedia.org/w/index.php?title=Test_Open&oldid=7",
    location: "Hawaii",
    source: "wikipedia",
    sourceUrl: "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
  },
  {
    name: "Test Championship",
    season,
    startDate: "2026-01-25",
    endDate: "2026-01-28",
    courseName: null,
    coursePar: null,
    courseYardage: null,
    courseArticleUrl: null,
    location: null,
    source: "wikipedia",
    sourceUrl: "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
  },
];

async function rowCount(): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    select count(*)::text as count from tournaments where season = ${season}`;
  return Number(row!.count);
}

afterAll(async () => {
  // Tournaments first: their `course_id` is a foreign key into the Courses seeded below.
  await sql`delete from tournaments where season = ${season}`;
  await sql`delete from courses where name like ${`%Venue ${season}`}`;
  await sql.end();
});

describe("re-ingesting", () => {
  it("leaves the same number of rows the second time", async () => {
    await upsertTournaments(db, records);
    expect(await rowCount()).toBe(2);

    await upsertTournaments(db, records);
    expect(await rowCount()).toBe(2);
  });

  it("updates a changed field in place rather than adding a row", async () => {
    const moved = records.map((r) => ({ ...r, startDate: "2026-01-19" }));
    await upsertTournaments(db, moved);

    expect(await rowCount()).toBe(2);
    const [row] = await sql<{ start_date: string }[]>`
      select start_date::text from tournaments where season = ${season} and name = 'Test Open'`;
    expect(row!.start_date).toBe("2026-01-19");
  });

  it("does not write anything for an empty record list", async () => {
    await upsertTournaments(db, []);
    expect(await rowCount()).toBe(2);
  });

  // A run whose fetch of the Tournament's own article failed has no revision URL to attribute
  // anything to, and must not wipe the par and yardage a run that did read it stored.
  it("keeps the Course facts an earlier run read when this run could not read the article", async () => {
    const facts = async () =>
      (
        await sql<{ course_name: string | null; course_par: number | null }[]>`
          select course_name, course_par from tournaments
          where season = ${season} and name = 'Test Open'`
      )[0]!;
    expect(await facts()).toMatchObject({ course_name: "Test Country Club", course_par: 70 });

    await upsertTournaments(db, [
      {
        ...records[0]!,
        courseName: null,
        coursePar: null,
        courseYardage: null,
        courseArticleUrl: null,
      },
    ]);

    expect(await facts()).toMatchObject({ course_name: "Test Country Club", course_par: 70 });
  });

  // An article that was read and no longer states a par is a fact about the article, so the
  // stored par goes. The revision that says so is stored in its place.
  it("clears a Course fact the article it read no longer states", async () => {
    await upsertTournaments(db, [
      {
        ...records[0]!,
        coursePar: null,
        courseArticleUrl: "https://en.wikipedia.org/w/index.php?title=Test_Open&oldid=8",
      },
    ]);

    const [row] = await sql<{ course_par: number | null; course_article_url: string }[]>`
      select course_par, course_article_url from tournaments
      where season = ${season} and name = 'Test Open'`;
    expect(row).toMatchObject({
      course_par: null,
      course_article_url: "https://en.wikipedia.org/w/index.php?title=Test_Open&oldid=8",
    });
  });
});

// The other half of #179's rule. `ingest:courses` keeps a link it could not re-confirm, which
// is only safe if something clears a link to a venue the Tournament has left. This is that
// something: it is the only place that sees both the stored Course name and the new one.
describe("a Tournament whose venue changes", () => {
  const revision = (oldid: number) =>
    `https://en.wikipedia.org/w/index.php?title=Test_Invitational&oldid=${oldid}`;

  /** A stored Tournament naming a Course, with a Course linked to it by hand. */
  async function seedLinked(
    name: string,
  ): Promise<{ record: TournamentRecord; courseId: number }> {
    const record: TournamentRecord = {
      name,
      season,
      startDate: "2026-02-01",
      endDate: "2026-02-04",
      courseName: "First Country Club",
      coursePar: 72,
      courseYardage: 7100,
      courseArticleUrl: revision(11),
      location: "Florida",
      source: "wikipedia",
      sourceUrl: "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
    };
    await upsertTournaments(db, [record]);
    const [course] = await sql<{ id: number }[]>`
      insert into courses (name, source, source_url)
      values (${`${name} Venue ${season}`}, 'wikipedia', 'https://en.wikipedia.org/wiki/Venue')
      returning id`;
    await sql`
      update tournaments set course_id = ${course!.id}, course_match = 'declared'
      where season = ${season} and name = ${name}`;
    return { record, courseId: course!.id };
  }

  const linkOf = async (name: string) =>
    (
      await sql<{ course_id: number | null; course_match: string | null }[]>`
        select course_id, course_match from tournaments
        where season = ${season} and name = ${name}`
    )[0]!;

  const courseNameOf = async (name: string) =>
    (
      await sql<{ course_name: string | null }[]>`
        select course_name from tournaments where season = ${season} and name = ${name}`
    )[0]!.course_name;

  it("clears both link columns where it writes a different Course name", async () => {
    const { record, courseId } = await seedLinked("Moved Invitational");
    expect(await linkOf(record.name)).toEqual({
      course_id: courseId,
      course_match: "declared",
    });

    await upsertTournaments(db, [
      { ...record, courseName: "Second Country Club", courseArticleUrl: revision(12) },
    ]);

    // Both, together: `tournaments_course_match_is_recorded` would refuse one without the other.
    expect(await linkOf(record.name)).toEqual({ course_id: null, course_match: null });
    expect(await courseNameOf(record.name)).toBe("Second Country Club");
  });

  it("leaves the link alone where the Course name it writes is the one already stored", async () => {
    const { record, courseId } = await seedLinked("Settled Invitational");
    const link = { course_id: courseId, course_match: "declared" };

    // A newer revision of the article, naming the same Course, and a date that moved.
    await upsertTournaments(db, [
      {
        ...record,
        startDate: "2026-02-02",
        endDate: "2026-02-05",
        courseArticleUrl: revision(12),
      },
    ]);
    expect(await linkOf(record.name)).toEqual(link);

    // And a run whose fetch of the article failed, which keeps the stored name — so it is not
    // a venue change, and must not take the link with it.
    await upsertTournaments(db, [
      {
        ...record,
        courseName: null,
        coursePar: null,
        courseYardage: null,
        courseArticleUrl: null,
      },
    ]);
    expect(await linkOf(record.name)).toEqual(link);
    expect(await courseNameOf(record.name)).toBe("First Country Club");
  });

  // An article that was read and names no Course clears `course_name`, so the link goes with
  // it: `is distinct from` treats a name becoming null as the change it is.
  it("clears the link where the article read now names no Course at all", async () => {
    const { record } = await seedLinked("Vacated Invitational");

    await upsertTournaments(db, [
      {
        ...record,
        courseName: null,
        coursePar: null,
        courseYardage: null,
        courseArticleUrl: revision(13),
      },
    ]);

    expect(await linkOf(record.name)).toEqual({ course_id: null, course_match: null });
    expect(await courseNameOf(record.name)).toBeNull();
  });
});
