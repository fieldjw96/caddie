// Proves against a real, migrated Postgres that the Source rule is the database's rule and
// not the ingest code's. Run by `npm run test:db` after `npm run db:migrate`; CI does both
// against a scratch postgres:17 in the `migrate` job.

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. The database tests need a migrated Postgres.");
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

// Unique per run, so the tests can share a database with an earlier run of themselves.
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let counter = 0;
const unique = () => `${run}${++counter}`;

type Row = Record<string, string | number | null>;

const ingested: Row = { source: "wikidata", source_url: "https://www.wikidata.org/wiki/Q1" };
const derived: Row = { source: "derived", derivation: "mean strokes gained over 2025 rounds" };

let playerId = 0;
let courseId = 0;
let tournamentId = 0;

/** A row for each table that is valid in everything except its provenance. */
const bodies: Record<string, () => Row> = {
  players: () => ({ wikidata_id: `Q${unique()}`, name: "A Player" }),
  // Attributed, so that an `opengolfapi` row is refused for its provenance and not for the
  // ODbL attribution courses_opengolfapi_is_attributed also demands.
  courses: () => ({ name: `Course ${unique()}`, attribution: "A Source's attribution" }),
  tournaments: () => ({
    name: `Tournament ${unique()}`,
    season: 2026,
    start_date: "2026-04-09",
    end_date: "2026-04-12",
    course_id: courseId,
  }),
  results: () => ({ player_id: playerId, tournament_id: tournamentId, position: 1 }),
  course_traits: () => ({
    course_id: courseId,
    trait: `length_${unique()}`,
    value: 7555,
    unit: "yards",
  }),
  player_strengths: () => ({
    player_id: playerId,
    strength: `driving_${unique()}`,
    value: 0.5,
  }),
};

const tables = Object.keys(bodies);

async function insert(table: string, row: Row): Promise<number> {
  const [inserted] = await sql<
    { id: number }[]
  >`insert into ${sql(table)} ${sql(row)} returning id`;
  if (!inserted) throw new Error(`insert into ${table} returned no row`);
  return inserted.id;
}

/** Resolves to the name of the constraint that refused the row, or fails if none did. */
async function refusal(table: string, row: Row): Promise<string> {
  try {
    await insert(table, row);
  } catch (error) {
    if (error instanceof postgres.PostgresError && error.constraint_name) {
      return error.constraint_name;
    }
    throw error;
  }
  throw new Error(`${table} accepted a row it should have refused: ${JSON.stringify(row)}`);
}

const created: Array<[string, number]> = [];

beforeAll(async () => {
  playerId = await insert("players", { ...bodies.players!(), ...ingested });
  courseId = await insert("courses", { ...bodies.courses!(), ...ingested });
  tournamentId = await insert("tournaments", { ...bodies.tournaments!(), ...ingested });
  created.push(["tournaments", tournamentId], ["courses", courseId], ["players", playerId]);
});

afterAll(async () => {
  // Children first, then the fixtures they reference.
  for (const [table, id] of created) {
    if (table === "players") await sql`delete from player_strengths where player_id = ${id}`;
    if (table === "players") await sql`delete from results where player_id = ${id}`;
    if (table === "courses") await sql`delete from course_traits where course_id = ${id}`;
  }
  for (const [table, id] of created) {
    await sql`delete from ${sql(table)} where id = ${id}`;
  }
  await sql.end();
});

describe.each(tables)("%s", (table) => {
  const body = bodies[table]!;
  const constraint = `${table}_source_is_recorded`;

  // player_strengths refuses every Source but `derived` outright, so an ingested row there is
  // stopped by that constraint before this one. It is tested on its own below.
  it.skipIf(table === "player_strengths")(
    "refuses an ingested row with no source_url",
    async () => {
      expect(await refusal(table, { ...body(), source: "opengolfapi" })).toBe(constraint);
      expect(await refusal(table, { ...body(), source: "wikipedia", source_url: "  " })).toBe(
        constraint,
      );
    },
  );

  it("refuses a derived row with no derivation", async () => {
    expect(await refusal(table, { ...body(), source: "derived" })).toBe(constraint);
    expect(await refusal(table, { ...body(), source: "derived", derivation: "" })).toBe(
      constraint,
    );
  });

  it("refuses a derived row that also sets source_url", async () => {
    expect(
      await refusal(table, { ...body(), ...derived, source_url: "https://example.org/" }),
    ).toBe(constraint);
  });

  it("refuses a row with no source at all", async () => {
    await expect(
      insert(table, { ...body(), source_url: "https://example.org/" }),
    ).rejects.toMatchObject({ code: "23502", column_name: "source" });
  });

  it("refuses a source outside the four", async () => {
    await expect(
      insert(table, { ...body(), source: "datagolf", source_url: "https://example.org/" }),
    ).rejects.toMatchObject({ code: "22P02" });
  });

  it("accepts a row whose Source is recorded", async () => {
    const provenance = table === "player_strengths" ? derived : ingested;
    const id = await insert(table, { ...body(), ...provenance });
    expect(id).toBeGreaterThan(0);
    if (table !== "results") created.unshift([table, id]);
  });
});

describe("player_strengths", () => {
  it("refuses a Player Strength from any Source but derived", async () => {
    expect(
      await refusal("player_strengths", { ...bodies.player_strengths!(), ...ingested }),
    ).toBe("player_strengths_are_derived");
  });
});

describe("re-ingesting", () => {
  it("cannot duplicate a result for the same player and tournament", async () => {
    // The `accepts` case above already stored this pair.
    expect(await refusal("results", { ...bodies.results!(), ...ingested })).toBe(
      "results_player_tournament_unique",
    );
  });

  it("cannot duplicate a player with the same Wikidata identifier", async () => {
    const [player] = await sql<{ wikidata_id: string }[]>`
      select wikidata_id from players where id = ${playerId}`;
    expect(
      await refusal("players", {
        ...bodies.players!(),
        wikidata_id: player!.wikidata_id,
        ...ingested,
      }),
    ).toBe("players_wikidata_id_unique");
  });
});
