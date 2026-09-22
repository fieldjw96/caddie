// Proves against a real, migrated Postgres that re-running the results ingest leaves the same
// number of rows, because the `(player_id, tournament_id)` unique index turns a second write
// into an update, and that the database refuses a round score on a standings row. See
// db/source-rule.db.test.ts for why this lives here rather than under `npm run test`.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureTournaments, upsertResults, type ResultRecord } from "../lib/results/ingest";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. The database tests need a migrated Postgres.");
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

// Unique per run, so these fixtures don't collide with an earlier run or another test file.
const season = 180000 + Math.floor(Math.random() * 9000);
const sourceUrl = "https://en.wikipedia.org/w/index.php?title=2025_PGA_Tour&oldid=1";

let playerIds: number[] = [];
let tournamentIds = new Map<string, number>();

beforeAll(async () => {
  const inserted = await sql<{ id: number }[]>`
    insert into players (wikidata_id, name, source, source_url)
    values (${`Q${season}1`}, 'Results Test One', 'wikidata', 'https://www.wikidata.org/wiki/Q1'),
           (${`Q${season}2`}, 'Results Test Two', 'wikidata', 'https://www.wikidata.org/wiki/Q2')
    returning id`;
  playerIds = inserted.map((row) => row.id);
  tournamentIds = await ensureTournaments(
    db,
    [
      {
        name: "Results Test Open",
        pageTitle: `${season} Results Test Open`,
        startDate: "2025-04-10",
        endDate: "2025-04-13",
        canceled: false,
      },
      {
        name: "Canceled Classic",
        pageTitle: "Canceled Classic",
        startDate: "2025-04-17",
        endDate: "2025-04-20",
        canceled: true,
      },
    ],
    season,
    sourceUrl,
  );
});

afterAll(async () => {
  await sql`delete from results where player_id in ${sql(playerIds)}`;
  await sql`delete from tournaments where season = ${season}`;
  await sql`delete from players where id in ${sql(playerIds)}`;
  await sql.end();
});

function record(playerId: number, overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    playerId,
    tournamentId: tournamentIds.get(`${season} Results Test Open`)!,
    position: 3,
    basis: "leaderboard",
    finish: "T3",
    round1: 70,
    round2: 71,
    round3: null,
    round4: null,
    source: "wikipedia",
    sourceUrl,
    ...overrides,
  };
}

async function resultCount(): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    select count(*)::text as count from results where player_id in ${sql(playerIds)}`;
  return Number(row!.count);
}

describe("ensureTournaments", () => {
  it("adds the season's scheduled Tournaments, skipping canceled ones, keyed by article", () => {
    expect([...tournamentIds.keys()]).toEqual([`${season} Results Test Open`]);
  });

  it("returns the same Tournament on a second run instead of adding one", async () => {
    const again = await ensureTournaments(
      db,
      [
        {
          name: "Results Test Open",
          pageTitle: `${season} Results Test Open`,
          startDate: "2025-04-10",
          endDate: "2025-04-13",
          canceled: false,
        },
      ],
      season,
      sourceUrl,
    );
    expect(again).toEqual(tournamentIds);
  });
});

describe("re-ingesting results", () => {
  it("leaves the same number of rows the second time", async () => {
    const records = playerIds.map((id) => record(id));
    await upsertResults(db, records);
    expect(await resultCount()).toBe(2);

    await upsertResults(db, records);
    expect(await resultCount()).toBe(2);
  });

  it("updates a changed finish in place, nulls included", async () => {
    await upsertResults(db, [record(playerIds[0]!, { position: null, finish: "CUT" })]);
    expect(await resultCount()).toBe(2);
    const [row] = await sql<
      { position: number | null; finish: string; round_3: number | null }[]
    >`
      select position, finish, round_3 from results where player_id = ${playerIds[0]!}`;
    expect(row).toEqual({ position: null, finish: "CUT", round_3: null });
  });
});

describe("the database", () => {
  it("refuses a round score on a standings row", async () => {
    const error = await upsertResults(db, [
      record(playerIds[1]!, { basis: "standings", round1: 70 }),
    ]).catch((e: unknown) => e);
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    expect(cause?.constraint_name).toBe("results_standings_have_no_rounds");
  });
});
