import { describe, expect, it } from "vitest";
import { courseProfile, coverageSentences, fitTraits, formatDates, matchCourse } from "./data";
import {
  TRUSTED_COURSE,
  TRUSTED_TRAITS,
  UNTRUSTED_COURSE,
  UNTRUSTED_TRAITS,
} from "./fixtures";

describe("matchCourse", () => {
  const courses = [
    { id: 1, name: "Bay Hill Club and Lodge" },
    { id: 2, name: "TPC Sawgrass" },
    { id: 3, name: "TPC Sawgrass" },
  ];

  it("takes the Tournament's own courseId first", () => {
    expect(
      matchCourse({ courseId: 2, courseName: "Bay Hill Club and Lodge" }, courses)?.id,
    ).toBe(2);
  });

  it("matches the venue's name exactly, ignoring case and spacing", () => {
    expect(
      matchCourse({ courseId: null, courseName: "  bay hill  club and LODGE" }, courses)?.id,
    ).toBe(1);
  });

  it("matches nothing rather than guessing between two Courses of one name", () => {
    expect(matchCourse({ courseId: null, courseName: "TPC Sawgrass" }, courses)).toBeNull();
  });

  it("matches nothing for a venue it does not hold, or none at all", () => {
    expect(matchCourse({ courseId: null, courseName: "Bay Hill" }, courses)).toBeNull();
    expect(matchCourse({ courseId: null, courseName: null }, courses)).toBeNull();
  });
});

describe("courseProfile", () => {
  it("states every Trait in its natural units for a Course whose holes are trusted", () => {
    const lines = courseProfile(TRUSTED_COURSE, TRUSTED_TRAITS);
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(byLabel).toMatchObject({
      Length: "7,466 yards",
      Par: "72",
      "Par mix": "4 par 3s, 10 par 4s, 4 par 5s",
      "Par 5 share": "22% of holes",
      "Mean par 4": "452 yards",
      "Longest par 4": "510 yards",
      "Slope against rating": "72.9 points",
      Altitude: "105 feet above sea level",
      "Green surface": "Bermuda",
      Architect: "Dick Wilson",
    });
    const length = lines.find((l) => l.label === "Length");
    expect(length && "detail" in length ? length.detail : null).toBe(
      "published championship total; plays like 7,450 yards adjusted for altitude",
    );
  });

  it("shows hole-derived Traits as unavailable, with the arithmetic, when holes are untrusted", () => {
    const lines = courseProfile(UNTRUSTED_COURSE, UNTRUSTED_TRAITS);
    for (const label of ["Par mix", "Par 5 share", "Mean par 4", "Longest par 4"]) {
      const line = lines.find((l) => l.label === label);
      expect(line?.value, label).toBeNull();
      expect(line && "reason" in line ? line.reason : "").toContain(
        "add up to 6,475 yards, 1,080 yards short of the published 7,555 yards",
      );
    }
    expect(lines.find((l) => l.label === "Length")?.value).toBe("7,555 yards");
  });

  it("never leaves a line blank", () => {
    const lines = courseProfile(TRUSTED_COURSE, TRUSTED_TRAITS);
    for (const line of lines) {
      if (line.value === null) expect(line.reason.length).toBeGreaterThan(10);
      else expect(line.value).not.toBe("");
    }
  });

  it("says why, when a Course is matched but no Source has stored its altitude or green surface", () => {
    const course = { ...TRUSTED_COURSE, altitude: null, greenSurface: null };
    const lines = courseProfile(course, TRUSTED_TRAITS);
    const altitude = lines.find((l) => l.label === "Altitude");
    const greenSurface = lines.find((l) => l.label === "Green surface");
    expect(altitude?.value).toBeNull();
    expect(altitude && "reason" in altitude ? altitude.reason : "").toContain(
      "no Source we hold has stored this Course's altitude",
    );
    expect(greenSurface?.value).toBeNull();
    expect(greenSurface && "reason" in greenSurface ? greenSurface.reason : "").toContain(
      "no Source we hold has stored this Course's green surface",
    );
  });

  it("shows the raw length alone when no altitude-adjusted length is stored", () => {
    const traits = { ...TRUSTED_TRAITS };
    delete (traits as Record<string, unknown>).altitude_adjusted_length_yards;
    const lines = courseProfile(TRUSTED_COURSE, traits);
    const length = lines.find((l) => l.label === "Length");
    expect(length && "detail" in length ? length.detail : null).toBe(
      "published championship total",
    );
  });

  it("states every line as unavailable when no Course is matched", () => {
    const lines = courseProfile(null, {});
    expect(lines.every((l) => l.value === null)).toBe(true);
  });
});

describe("fitTraits", () => {
  it("passes the weighed Traits and nulls for the ones the Course lacks", () => {
    expect(fitTraits(UNTRUSTED_TRAITS)).toEqual({
      length_yards: 7555,
      slope_rating_gap: 60.8,
      mean_par_4_yards: null,
      longest_par_4_yards: null,
      par_5_share: null,
    });
  });
});

describe("coverageSentences", () => {
  it("names the events covered, apart by table, and says regular events are not", () => {
    const text = coverageSentences({
      seasons: [2025],
      leaderboardEvents: ["Masters Tournament", "The Open Championship"],
      standingsEvents: ["Genesis Invitational"],
    }).join(" ");
    expect(text).toContain("The record covers 3 events from the 2025 season.");
    expect(text).toContain("Masters Tournament and The Open Championship");
    expect(text).toContain("top 30 of the FedEx Cup standings");
    expect(text).toContain(
      "Regular tour events are not covered, because no source we can publish from carries their results.",
    );
  });

  it("says plainly when nothing is stored", () => {
    expect(
      coverageSentences({ seasons: [], leaderboardEvents: [], standingsEvents: [] })[0],
    ).toMatch(/No results are stored yet/);
  });
});

describe("formatDates", () => {
  it("reads a week in one month, and one across two", () => {
    expect(formatDates("2026-09-24", "2026-09-27")).toBe("24–27 September 2026");
    expect(formatDates("2026-09-30", "2026-10-03")).toBe("30 September – 3 October 2026");
  });
});
