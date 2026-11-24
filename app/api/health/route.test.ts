// `/api/health`'s own database reads are stubbed here: this suite runs under `npm run test`,
// which has no Postgres to talk to, so `db/client.ts` and `lib/ingest/rankable-query.ts` are
// replaced with a reader this file controls. What stays real is everything pure on top —
// `upcomingTournaments`, `chooseRankableTournament`, `checkRankable` — so a wrong `rankable`
// object here is a wrong one in production, not an artifact of the stub.

import { afterEach, describe, expect, it, vi } from "vitest";

const DUMMY_URL = "postgres://health_user:health_password@localhost:5432/none";

vi.mock("../../../db/client", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("../../../lib/ingest/rankable-query", () => ({
  gatherRankabilityData: vi.fn(),
}));

import { db } from "../../../db/client";
import { gatherRankabilityData } from "../../../lib/ingest/rankable-query";
import { GET } from "./route";

const execute = vi.mocked(db.execute);
const gather = vi.mocked(gatherRankabilityData);

/** `db.execute`'s real return type carries postgres.js's result metadata; the route reads
 * only the one row, so the stub only needs to shrug that off. */
function mockTournamentsCount(tournaments: number): void {
  execute.mockResolvedValue([{ tournaments }] as unknown as Awaited<
    ReturnType<typeof db.execute>
  >);
}

// Far enough out that `upcomingTournaments` treats it as upcoming no matter when this runs.
const START = "9999-06-18";
const END = "9999-06-21";

const COURSE = { id: 1, name: "TPC Sawgrass" };

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("reports rankable when the homepage's Tournament has a Course Trait and a Strength", async () => {
    process.env.DATABASE_URL = DUMMY_URL;
    mockTournamentsCount(12);
    gather.mockResolvedValue({
      schedule: [
        {
          name: "The Players Championship",
          startDate: START,
          endDate: END,
          courseName: COURSE.name,
          courseId: COURSE.id,
          sourceUrl: "https://en.wikipedia.org/wiki/The_Players_Championship",
        },
      ],
      courses: [COURSE],
      traitCounts: new Map([[COURSE.id, 9]]),
      anyPlayerHasStrength: true,
    });

    const body = await (await GET()).json();

    expect(body.ok).toBe(true);
    expect(body.rankable).toEqual({
      state: "rankable",
      tournament: "The Players Championship",
      course: COURSE.name,
      courseTraitCount: 9,
      anyPlayerHasStrength: true,
      reason: null,
    });
  });

  it("reports unrankable with checkRankable's own reason when nothing in the schedule passes", async () => {
    process.env.DATABASE_URL = DUMMY_URL;
    mockTournamentsCount(3);
    gather.mockResolvedValue({
      schedule: [
        {
          name: "Baycurrent Classic",
          startDate: START,
          endDate: END,
          courseName: "Accordia Golf Narashino C.C.",
          courseId: null,
          sourceUrl: null,
        },
      ],
      courses: [],
      traitCounts: new Map(),
      anyPlayerHasStrength: true,
    });

    const body = await (await GET()).json();

    expect(body.ok).toBe(true);
    expect(body.rankable.state).toBe("unrankable");
    expect(body.rankable.tournament).toBe("Baycurrent Classic");
    expect(body.rankable.course).toBeNull();
    expect(body.rankable.reason).toContain("Baycurrent Classic");
    expect(body.rankable.reason).toContain("zero Player rows");
  });

  it("names the true next Tournament when the page falls forward past it", async () => {
    process.env.DATABASE_URL = DUMMY_URL;
    mockTournamentsCount(4);
    const RANKABLE_COURSE = { id: 2, name: "Seaside At Sea Island Golf Club" };
    gather.mockResolvedValue({
      schedule: [
        {
          name: "Butterfield Bermuda Championship",
          startDate: START,
          endDate: END,
          courseName: "Port Royal Golf Course",
          courseId: null,
          sourceUrl: null,
        },
        {
          name: "RSM Classic",
          startDate: END,
          endDate: "9999-06-28",
          courseName: RANKABLE_COURSE.name,
          courseId: RANKABLE_COURSE.id,
          sourceUrl: null,
        },
      ],
      courses: [RANKABLE_COURSE],
      traitCounts: new Map([[RANKABLE_COURSE.id, 5]]),
      anyPlayerHasStrength: true,
    });

    const body = await (await GET()).json();

    expect(body.rankable.state).toBe("rankable");
    expect(body.rankable.tournament).toBe("RSM Classic");
    expect(body.rankable.trueNextTournament).toBe("Butterfield Bermuda Championship");
  });

  it("reports no-next-tournament, distinctly from an unrankable one, for an empty schedule", async () => {
    process.env.DATABASE_URL = DUMMY_URL;
    mockTournamentsCount(0);
    gather.mockResolvedValue({
      schedule: [],
      courses: [],
      traitCounts: new Map(),
      anyPlayerHasStrength: false,
    });

    const body = await (await GET()).json();

    expect(body.ok).toBe(true);
    expect(body.rankable).toEqual({
      state: "no-next-tournament",
      tournament: null,
      course: null,
      courseTraitCount: 0,
      anyPlayerHasStrength: false,
      reason: null,
    });
  });

  it("never leaks the connection string, a credential, or DATABASE_URL/POSTGRES_URL's value", async () => {
    process.env.DATABASE_URL = DUMMY_URL;
    mockTournamentsCount(1);
    gather.mockResolvedValue({
      schedule: [],
      courses: [],
      traitCounts: new Map(),
      anyPlayerHasStrength: false,
    });

    const text = JSON.stringify(await (await GET()).json());

    expect(text).not.toContain(DUMMY_URL);
    expect(text).not.toContain("health_password");
    expect(text).not.toContain(process.env.DATABASE_URL);
  });
});
