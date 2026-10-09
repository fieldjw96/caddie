import { describe, expect, it } from "vitest";
import { currentSeasonYear, seasonsToIngest } from "./season";

describe("currentSeasonYear", () => {
  const end = new Date(Date.UTC(2026, 7, 16));

  it("stays on this year's article until its regular season has ended", () => {
    expect(currentSeasonYear(2026, end, new Date("2026-08-16T00:00:00Z"))).toBe(2026);
  });

  it("moves to next year's article once it has", () => {
    expect(currentSeasonYear(2026, end, new Date("2026-08-17T00:00:00Z"))).toBe(2027);
  });
});

describe("seasonsToIngest", () => {
  // Two seasons, because `ingest:results` reads two, and a season with results but no Course
  // names has nothing a venue record can join on.
  it("reads the current season and the ones the results ingest reads", () => {
    expect(seasonsToIngest(2026, "2026-10-09")).toEqual([2025, 2026]);
  });

  it("adds the next season's article once that is the current one", () => {
    expect(seasonsToIngest(2027, "2026-12-20")).toEqual([2025, 2026, 2027]);
  });

  it("names each season once, oldest first", () => {
    expect(seasonsToIngest(2025, "2026-01-02")).toEqual([2025, 2026]);
  });
});
