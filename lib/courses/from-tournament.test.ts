import { describe, expect, it } from "vitest";
import {
  planArticleCourses,
  planTournamentArticleCourse,
  venueKey,
  wikipediaAttribution,
  type KnownCourse,
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

describe("venueKey", () => {
  it("reads two spellings of one venue as one, by lib/courses/match.ts's own rule", () => {
    expect(venueKey("The Riviera Country Club")).toBe(venueKey("Riviera Country Club"));
    expect(venueKey("Yokohama Country Club")).toBe(venueKey("yokohama  golf   club"));
    expect(venueKey("Pinehurst Resort & Country Club")).toBe(venueKey("Pinehurst"));
    // A qualifier is not generic: a club's two courses stay two venues.
    expect(venueKey("TPC Sawgrass Stadium Course")).not.toBe(venueKey("TPC Sawgrass"));
  });

  // Nothing distinctive is left of these, and keying every such venue alike would merge two
  // real courses. The whole normalised name is kept instead.
  it("keeps a name of nothing but generic words apart from another", () => {
    expect(venueKey("The Golf Club")).toBe("the golf club");
    expect(venueKey("The Country Club")).not.toBe(venueKey("The Golf Club"));
  });
});

describe("planArticleCourses", () => {
  /** The 2025 edition of the Baycurrent Classic, spelled as a different editor spelled it. */
  const BAYCURRENT_2025: TournamentCourseRow = {
    id: 20,
    name: "Baycurrent Classic (2025)",
    startDate: "2025-10-12",
    courseName: "The Yokohama Golf Club",
    coursePar: 70,
    courseYardage: 7222,
    courseArticleUrl: "https://en.wikipedia.org/w/index.php?title=Baycurrent&oldid=1",
  };

  const stored = (overrides: Partial<KnownCourse> = {}): KnownCourse => ({
    courseId: 7,
    openGolfApiId: null,
    name: "Yokohama Country Club",
    ...overrides,
  });

  it("plans a Course for every unmatched Tournament, not only the next one", () => {
    const plan = planArticleCourses([baycurrent(), BERMUDA], new Set(), []);

    expect(plan.skipped).toEqual([]);
    expect(plan.venues.map((v) => v.name)).toEqual([
      "Port Royal Golf Course",
      "Yokohama Country Club",
    ]);
    expect(plan.venues.flatMap((v) => v.tournaments.map((t) => t.id))).toEqual([51, 50]);
  });

  // OpenGolfAPI stays the preferred Source: it holds a card, tees, Slope and Rating and the
  // holes, where an article holds a name, a par and a total.
  it("leaves a Tournament OpenGolfAPI matched entirely alone", () => {
    const plan = planArticleCourses([baycurrent(), BERMUDA], new Set([50]), []);

    expect(plan.venues).toHaveLength(1);
    expect(plan.venues[0]?.tournaments).toEqual([
      { id: 51, name: "Butterfield Bermuda Championship", startDate: "2026-10-25" },
    ]);
  });

  // The whole point: two editions at one venue must reach one row, or the venue record joins
  // nothing and the column stays empty.
  it("gives two Tournaments at one venue one row, under two spellings", () => {
    const plan = planArticleCourses([baycurrent(), BAYCURRENT_2025], new Set(), []);

    expect(plan.venues).toHaveLength(1);
    const [venue] = plan.venues;
    expect(venue?.tournaments.map((t) => t.id)).toEqual([50, 20]);
    // Most recent first, so it is this year's reading of the par and the yardage that stands.
    expect(venue?.row).toMatchObject({ name: "Yokohama Country Club", par: 71 });
  });

  it("reuses a stored Course the venue reads as, rather than storing a second", () => {
    const plan = planArticleCourses([BAYCURRENT_2025], new Set(), [stored()]);

    expect(plan.venues).toHaveLength(1);
    expect(plan.venues[0]?.row).toBeNull();
    expect(plan.venues[0]?.reuse).toMatchObject({ courseId: 7 });
    expect(plan.venues[0]?.tournaments).toEqual([
      { id: 20, name: "Baycurrent Classic (2025)", startDate: "2025-10-12" },
    ]);
  });

  it("reuses an OpenGolfAPI Course the venue reads as, id or not yet", () => {
    const fromApi = stored({
      courseId: 9,
      openGolfApiId: "ogc-1",
      name: "Yokohama Golf Club",
    });
    expect(planArticleCourses([baycurrent()], new Set(), [fromApi]).venues[0]?.reuse).toBe(
      fromApi,
    );

    // A row this run's matches are about to write has no `courses.id` yet; the store resolves
    // it from the OpenGolfAPI id once it has one.
    const unwritten = { ...fromApi, courseId: null };
    const plan = planArticleCourses([baycurrent()], new Set(), [unwritten]);
    expect(plan.venues[0]).toMatchObject({ row: null, reuse: unwritten });
  });

  // Two stored rows that read alike may well be one venue, but merging them is a Ticket of its
  // own, and guessing which of the two was played on is the confidently-wrong link this whole
  // path exists to avoid.
  it("skips a venue that reads as two stored Courses, naming both", () => {
    const plan = planArticleCourses([baycurrent()], new Set(), [
      stored({ courseId: 7, openGolfApiId: "ogc-1" }),
      stored({ courseId: 8, name: "Yokohama Golf Club" }),
    ]);

    expect(plan.venues).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toContain("reads as 2 stored Courses");
    expect(plan.skipped[0]?.reason).toContain("OpenGolfAPI ogc-1");
  });

  it("counts and skips an article that states no Course, no par or no yardage", () => {
    const plan = planArticleCourses(
      [
        baycurrent({ id: 1, name: "Austin Championship", courseName: null }),
        baycurrent({ id: 2, name: "No Par Open", coursePar: null }),
        baycurrent({ id: 3, name: "No Yardage Open", courseYardage: null }),
        BERMUDA,
      ],
      new Set(),
      [],
    );

    expect(plan.venues).toHaveLength(1);
    expect(plan.skipped.map((s) => s.tournamentName)).toEqual([
      "Austin Championship",
      "No Par Open",
      "No Yardage Open",
    ]);
    expect(plan.skipped[0]?.reason).toBe("its article names no Course");
  });

  it("plans nothing a second time once what it planned is stored", () => {
    const first = planArticleCourses([baycurrent(), BAYCURRENT_2025], new Set(), []);
    const nowStored: KnownCourse[] = first.venues.map((v, i) => ({
      courseId: 100 + i,
      openGolfApiId: null,
      name: v.row!.name,
    }));

    const second = planArticleCourses([baycurrent(), BAYCURRENT_2025], new Set(), nowStored);

    expect(second.venues.map((v) => v.row)).toEqual([null]);
    expect(second.venues[0]?.reuse?.courseId).toBe(100);
    expect(second.venues[0]?.tournaments).toEqual(first.venues[0]?.tournaments);
  });
});
