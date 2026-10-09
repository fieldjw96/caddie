import { describe, expect, it } from "vitest";
import {
  planNextTournamentCourse,
  planTournamentArticleCourse,
  wikipediaAttribution,
  type TournamentCourseRow,
} from "./from-tournament";

const ARTICLE =
  "https://en.wikipedia.org/w/index.php?title=Baycurrent_Classic&oldid=1378612509";

/** The Baycurrent Classic as `tournaments` holds it once `ingest:schedule` has run. */
function baycurrent(overrides: Partial<TournamentCourseRow> = {}): TournamentCourseRow {
  return {
    id: 50,
    name: "Baycurrent Classic",
    startDate: "2026-10-11",
    courseName: "Yokohama Country Club",
    coursePar: 71,
    courseYardage: 7315,
    courseArticleUrl: ARTICLE,
    ...overrides,
  };
}

const BERMUDA: TournamentCourseRow = {
  id: 51,
  name: "Butterfield Bermuda Championship",
  startDate: "2026-10-25",
  courseName: "Port Royal Golf Course",
  coursePar: 71,
  courseYardage: 6828,
  courseArticleUrl: "https://en.wikipedia.org/w/index.php?title=Port_Royal&oldid=2",
};

describe("planTournamentArticleCourse", () => {
  it("creates a Course from the facts the Tournament's own article states", () => {
    const outcome = planTournamentArticleCourse(baycurrent());

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.tournamentId).toBe(50);
    expect(outcome.row).toMatchObject({
      name: "Yokohama Country Club",
      par: 71,
      publishedYardage: 7315,
      source: "wikipedia",
      sourceUrl: ARTICLE,
      openGolfApiId: null,
      derivation: null,
    });
    expect(outcome.row.attribution).toBe(wikipediaAttribution("Baycurrent Classic"));
  });

  // The one check standing between this repo and Augusta's member tees. An article states a
  // total, never a card, so there is nothing here to check holes against and nothing to trust.
  it("leaves holes and everything derived from them absent, not zero", () => {
    const outcome = planTournamentArticleCourse(baycurrent());

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.row).toMatchObject({
      holes: null,
      holesCheckedTee: null,
      holesYardageSum: null,
      holesYardageDifference: null,
      holesTrusted: null,
      tees: null,
      architect: null,
    });
  });

  it("reads a qualified Course name the way the OpenGolfAPI match reads it", () => {
    const outcome = planTournamentArticleCourse(
      baycurrent({ courseName: "{{nowrap|TPC Sawgrass, (Stadium Course)}}" }),
    );

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.row.name).toBe("TPC Sawgrass Stadium Course");
  });

  it("skips an article that names no Course, cleanly and with the reason", () => {
    const outcome = planTournamentArticleCourse(baycurrent({ courseName: null }));

    expect(outcome).toMatchObject({
      status: "skipped",
      tournamentId: 50,
      tournamentName: "Baycurrent Classic",
      reason: "its article names no Course",
    });
  });

  it("skips an article that states no par, and one that states no yardage", () => {
    expect(planTournamentArticleCourse(baycurrent({ coursePar: null }))).toMatchObject({
      status: "skipped",
      reason: "its article states no par that reads as a number",
    });
    expect(planTournamentArticleCourse(baycurrent({ courseYardage: null }))).toMatchObject({
      status: "skipped",
      reason: "its article states no yardage that reads as a number of yards",
    });
  });

  it("skips an article naming several courses, because the facts belong to one of them", () => {
    const outcome = planTournamentArticleCourse(
      baycurrent({ courseName: "Pebble Beach Golf Links, Spyglass Hill Golf Course" }),
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.reason).toContain("names 2 courses");
  });

  it("skips facts with no revision behind them", () => {
    expect(planTournamentArticleCourse(baycurrent({ courseArticleUrl: null }))).toMatchObject({
      status: "skipped",
      reason: "its article's revision was not recorded with those facts",
    });
  });

  it("skips a record no Tour course could have, by the same rule a match is held to", () => {
    const outcome = planTournamentArticleCourse(baycurrent({ coursePar: 58 }));

    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.reason).toContain("no Tour course is");

    const short = planTournamentArticleCourse(baycurrent({ courseYardage: 2194 }));
    expect(short.status).toBe("skipped");
    if (short.status !== "skipped") return;
    expect(short.reason).toContain("shorter than any Tour course");
  });
});

describe("planNextTournamentCourse", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("falls back for the next Tournament when OpenGolfAPI matched nothing for it", () => {
    const outcome = planNextTournamentCourse([baycurrent(), BERMUDA], new Set(), now);

    expect(outcome).toMatchObject({ status: "created", tournamentId: 50 });
  });

  // OpenGolfAPI stays the preferred Source: it holds a card, tees, Slope and Rating and the
  // holes, where an article holds a name, a par and a total.
  it("falls back for nothing when OpenGolfAPI matched the next Tournament", () => {
    expect(planNextTournamentCourse([baycurrent(), BERMUDA], new Set([50]), now)).toBeNull();
  });

  it("ignores a later Tournament OpenGolfAPI could not match", () => {
    expect(planNextTournamentCourse([baycurrent(), BERMUDA], new Set([50]), now)).toBeNull();
    // Only the next one is considered at all: Bermuda is three weeks out and unmatched, and
    // still gets no Course of its own from here.
    const outcome = planNextTournamentCourse([baycurrent(), BERMUDA], new Set(), now);
    expect(outcome).toMatchObject({ tournamentId: 50 });
  });

  it("falls back for nothing once the season's last Tournament has been played", () => {
    const after = new Date("2026-12-01T00:00:00Z");
    expect(planNextTournamentCourse([baycurrent(), BERMUDA], new Set(), after)).toBeNull();
  });
});
