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
    source: "wikipedia",
    sourceUrl: "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
  },
  {
    name: "Test Championship",
    season,
    startDate: "2026-01-25",
    endDate: "2026-01-28",
    courseName: null,
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
});
