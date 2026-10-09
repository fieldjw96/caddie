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
  await sql`delete from tournaments where season = ${season}`;
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
