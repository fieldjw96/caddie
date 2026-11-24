import { describe, expect, it } from "vitest";
import { DECLARED_MATCHES } from "../courses/match";
import { fitScore, normalise, TRAIT_SCALES } from "../fit";
import {
  classifyCoverageEditions,
  courseProfile,
  coverageSentences,
  fitTraits,
  formatDates,
  formatDatesAndCourse,
  formatFreshnessDate,
  isStale,
  matchCourse,
  holesUnavailableReason,
  parUnavailableReason,
  scheduledCourseLabel,
} from "./data";
import {
  TRUSTED_COURSE,
  TRUSTED_TRAITS,
  UNTRUSTED_COURSE,
  UNTRUSTED_TRAITS,
  UNTRUSTED_TRAITS_WITH_PAR_MIX,
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

  for (const declared of DECLARED_MATCHES) {
    it(`matches ${JSON.stringify(declared.schedule)} to its declared Course by name`, () => {
      const stocked = [
        { id: 1, name: declared.name },
        { id: 2, name: "Some Other Club" },
      ];
      expect(matchCourse({ courseId: null, courseName: declared.schedule }, stocked)?.id).toBe(
        1,
      );
    });
  }

  it("matches the qualified name of one course of a multi-course schedule entry", () => {
    const stocked = [
      { id: 1, name: "Torrey Pines Golf Course South Course" },
      { id: 2, name: "Torrey Pines Golf Course North Course" },
    ];
    expect(
      matchCourse(
        {
          courseId: null,
          courseName: "Torrey Pines Golf Course, (South Course), (North Course)",
        },
        stocked,
      )?.id,
    ).toBe(1);
  });

  it("falls back to a distinct club scheduledCourses returns when no qualified name matches", () => {
    // Neither the declared name ("Torrey Pines South Course") nor either qualified name
    // ("Torrey Pines Golf Course South/North Course") reads as the one stored row below, so
    // only step (4), the bare club, reaches it.
    const stocked = [{ id: 1, name: "Torrey Pines Golf Course" }];
    expect(
      matchCourse(
        {
          courseId: null,
          courseName: "Torrey Pines Golf Course, (South Course), (North Course)",
        },
        stocked,
      )?.id,
    ).toBe(1);
  });

  it("matches nothing when two stored Courses share a name reached at the declared step", () => {
    const declared = DECLARED_MATCHES[0]!;
    const stocked = [
      { id: 1, name: declared.name },
      { id: 2, name: declared.name },
    ];
    expect(matchCourse({ courseId: null, courseName: declared.schedule }, stocked)).toBeNull();
  });

  it("matches nothing when two stored Courses share a name reached at the club step", () => {
    const stocked = [
      { id: 1, name: "Torrey Pines Golf Course" },
      { id: 2, name: "Torrey Pines Golf Course" },
    ];
    expect(
      matchCourse(
        {
          courseId: null,
          courseName: "Torrey Pines Golf Course, (South Course), (North Course)",
        },
        stocked,
      ),
    ).toBeNull();
  });
});

describe("scheduledCourseLabel", () => {
  it("renders one club's several listed courses in words", () => {
    expect(
      scheduledCourseLabel("Sea Island Golf Club, (Seaside Course), (Plantation Course)"),
    ).toBe("Sea Island Golf Club (Seaside Course and Plantation Course)");
    expect(
      scheduledCourseLabel("Torrey Pines Golf Course, (South Course), (North Course)"),
    ).toBe("Torrey Pines Golf Course (South Course and North Course)");
  });

  it("joins two distinct clubs by name, not by qualifier", () => {
    expect(
      scheduledCourseLabel("{{nowrap|Pebble Beach Golf Links, Spyglass Hill Golf Course}}"),
    ).toBe("Pebble Beach Golf Links and Spyglass Hill Golf Course");
  });

  it("returns a single scheduled course's own name unchanged", () => {
    expect(scheduledCourseLabel("Black Desert Resort")).toBe("Black Desert Resort");
    expect(scheduledCourseLabel("TPC Sawgrass, (Stadium Course)")).toBe(
      "TPC Sawgrass Stadium Course",
    );
  });

  for (const declared of DECLARED_MATCHES) {
    it(`renders ${JSON.stringify(declared.schedule)} with no leftover markup`, () => {
      const label = scheduledCourseLabel(declared.schedule);
      expect(label).not.toContain("{{");
      expect(label).not.toContain("}}");
      expect(label).not.toContain(", (");
    });
  }
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

  it("shows the yardage-gated Traits as unavailable, with the arithmetic, when holes are untrusted", () => {
    const lines = courseProfile(UNTRUSTED_COURSE, UNTRUSTED_TRAITS);
    for (const label of ["Mean par 4", "Longest par 4"]) {
      const line = lines.find((l) => l.label === label);
      expect(line?.value, label).toBeNull();
      expect(line && "reason" in line ? line.reason : "").toContain(
        "add up to 6,475 yards, 1,080 yards short of the published 7,555 yards",
      );
    }
    expect(lines.find((l) => l.label === "Length")?.value).toBe("7,555 yards");
  });

  it("shows the par mix as unavailable, naming the par check rather than the yardage sum, when it is not stored", () => {
    const lines = courseProfile(UNTRUSTED_COURSE, UNTRUSTED_TRAITS);
    for (const label of ["Par mix", "Par 5 share"]) {
      const line = lines.find((l) => l.label === label);
      expect(line?.value, label).toBeNull();
      const reason = line && "reason" in line ? line.reason : "";
      expect(reason).toContain("par check");
      expect(reason).not.toContain("6,475 yards");
    }
  });

  it("shows the par mix and par 5 share for an untrusted Course whose pars are sound, while the par-4 lengths stay refused", () => {
    const lines = courseProfile(UNTRUSTED_COURSE, UNTRUSTED_TRAITS_WITH_PAR_MIX);
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(byLabel["Par mix"]).toBe("4 par 3s, 10 par 4s, 4 par 5s");
    expect(byLabel["Par 5 share"]).toBe("22% of holes");

    for (const label of ["Mean par 4", "Longest par 4"]) {
      const line = lines.find((l) => l.label === label);
      expect(line?.value, label).toBeNull();
      expect(line && "reason" in line ? line.reason : "").toContain(
        "add up to 6,475 yards, 1,080 yards short of the published 7,555 yards",
      );
    }
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

  it("says about for an altitude read off the elevation model", () => {
    const course = { ...TRUSTED_COURSE, altitude: 174, altitudeSource: "copernicus" as const };
    const altitude = courseProfile(course, TRUSTED_TRAITS).find((l) => l.label === "Altitude");
    expect(altitude?.value).toBe("about 174 feet above sea level");
  });

  it("names the hand-entered card, not OpenGolfAPI, when that card fails its check", () => {
    const declared = {
      ...UNTRUSTED_COURSE,
      source: "wikipedia" as const,
      holesSource: "declared" as const,
      holesSourceUrl: "https://example.com/card",
    };
    const reason = holesUnavailableReason(declared);
    expect(reason).toContain("The hand-entered card's");
    expect(reason).not.toContain("OpenGolfAPI");
    expect(holesUnavailableReason({ ...declared, holesTrusted: null })).toContain(
      "hand-entered card could not be checked",
    );
  });

  it("does not blame the Wikipedia article for a Course with holes from elsewhere", () => {
    const osm = {
      ...TRUSTED_COURSE,
      source: "wikipedia" as const,
      holesSource: "openstreetmap" as const,
      holesSourceUrl: "https://www.openstreetmap.org/way/1",
      holesTrusted: null,
    };
    expect(holesUnavailableReason(osm)).toContain("no card yardages");
    expect(parUnavailableReason(osm)).toContain("fails the par check");
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

  it("includes Location when passed and non-null", () => {
    const lines = courseProfile(TRUSTED_COURSE, TRUSTED_TRAITS, "Georgia");
    const location = lines.find((l) => l.label === "Location");
    expect(location?.value).toBe("Georgia");
  });

  it("omits Location when not passed or null", () => {
    const linesWithoutLocation = courseProfile(TRUSTED_COURSE, TRUSTED_TRAITS, null);
    const linesWithoutParam = courseProfile(TRUSTED_COURSE, TRUSTED_TRAITS);
    expect(linesWithoutLocation.find((l) => l.label === "Location")).toBeUndefined();
    expect(linesWithoutParam.find((l) => l.label === "Location")).toBeUndefined();
  });
});

describe("fitTraits", () => {
  it("weighs the altitude-adjusted length where one is stored", () => {
    expect(fitTraits(TRUSTED_TRAITS).length_yards).toBe(7450);
  });

  it("weighs the raw published total where no altitude adjustment is stored", () => {
    expect(fitTraits(UNTRUSTED_TRAITS)).toEqual({
      length_yards: 7555,
      slope_rating_gap: 60.8,
      mean_par_4_yards: null,
      longest_par_4_yards: null,
      par_5_share: null,
    });
  });

  it("is null when neither Length Trait is stored", () => {
    expect(fitTraits({}).length_yards).toBeNull();
  });

  it("reaches the Fit Score: an altitude adjustment changes the length_yards contribution, not just the picker", () => {
    const noAltitudeTraits = Object.fromEntries(
      Object.entries(TRUSTED_TRAITS).filter(
        ([name]) => name !== "altitude_adjusted_length_yards",
      ),
    );
    const strengths = { skill: 0.8 };
    const adjusted = fitScore(fitTraits(TRUSTED_TRAITS), strengths).components.find(
      (c) => c.trait === "length_yards",
    )!;
    const unadjusted = fitScore(fitTraits(noAltitudeTraits), strengths).components.find(
      (c) => c.trait === "length_yards",
    )!;
    expect(adjusted.traitValue).toBe(7450);
    expect(unadjusted.traitValue).toBe(7466);
    expect(adjusted.contribution).not.toBeNull();
    expect(adjusted.contribution).not.toBe(unadjusted.contribution);
  });

  it("weighs a Course with no stored altitude on its raw published total rather than refusing it", () => {
    const fit = fitScore(fitTraits(UNTRUSTED_TRAITS), { skill: 0.8 });
    const length = fit.components.find((c) => c.trait === "length_yards")!;
    expect(length.traitValue).toBe(7555);
    expect(length.contribution).not.toBeNull();
    expect(fit.knownWeight).toBe(0.3);
  });

  it("agrees with the Weightings panel's demand figure for Length, for a Course with an altitude adjustment", () => {
    // app/ranking.tsx's Weightings panel computes `normalise(traits[trait], scale.min, scale.max)`
    // straight off the same `traits` object fitScore is handed below: this pins that both read
    // the altitude-adjusted value, not the raw one.
    const traits = fitTraits(TRUSTED_TRAITS);
    const scale = TRAIT_SCALES.length_yards;
    const demandShown = normalise(traits.length_yards!, scale.min, scale.max);
    const length = fitScore(traits, {}).components.find((c) => c.trait === "length_yards")!;
    expect(traits.length_yards).toBe(7450);
    expect(length.normalised).toBe(demandShown);
  });
});

describe("coverageSentences", () => {
  it("names the events covered, apart by table, and says regular events are not", () => {
    const text = coverageSentences({
      seasons: [2025],
      leaderboardEvents: [
        { name: "Masters Tournament", season: 2025 },
        { name: "The Open Championship", season: 2025 },
      ],
      standingsEvents: [{ name: "Genesis Invitational", season: 2025 }],
    }).join(" ");
    expect(text).toContain("The record covers 3 events from the 2025 season.");
    expect(text).toContain("Masters Tournament (2025) and The Open Championship (2025)");
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

describe("classifyCoverageEditions", () => {
  it("classifies each (name, season) edition from its own rows only", () => {
    const { leaderboardEvents, standingsEvents } = classifyCoverageEditions([
      { name: "Masters Tournament", season: 2025, basis: "leaderboard" },
      { name: "Masters Tournament", season: 2025, basis: "standings" },
      { name: "Masters Tournament", season: 2026, basis: "standings" },
    ]);
    expect(leaderboardEvents).toEqual([{ name: "Masters Tournament", season: 2025 }]);
    expect(standingsEvents).toEqual([{ name: "Masters Tournament", season: 2026 }]);

    const total = leaderboardEvents.length + standingsEvents.length;
    expect(total).toBe(2);

    const text = coverageSentences({
      seasons: [2025, 2026],
      leaderboardEvents,
      standingsEvents,
    }).join(" ");
    expect(text).toContain("2025");
    expect(text).toContain("2026");
    const leaderboardSentence = text
      .split(". ")
      .find((s) => s.startsWith("Full-field leaderboards"));
    expect(leaderboardSentence).not.toContain("2026");
  });
});

describe("formatDates", () => {
  it("reads a week in one month, and one across two", () => {
    expect(formatDates("2026-09-24", "2026-09-27")).toBe("24–27 September 2026");
    expect(formatDates("2026-09-30", "2026-10-03")).toBe("30 September – 3 October 2026");
  });
});

describe("formatDatesAndCourse", () => {
  it("appends location to the dates and course when non-null", () => {
    expect(
      formatDatesAndCourse("2026-11-18", "2026-11-23", "Sea Island Golf Club", "Georgia"),
    ).toBe("18–23 November 2026, at Sea Island Golf Club, Georgia");
  });

  it("omits location when null", () => {
    expect(
      formatDatesAndCourse("2026-11-18", "2026-11-23", "Sea Island Golf Club", null),
    ).toBe("18–23 November 2026, at Sea Island Golf Club");
  });

  it("says Course not yet known when no course is matched, with location appended", () => {
    expect(formatDatesAndCourse("2026-11-18", "2026-11-23", null, "Georgia")).toBe(
      "18–23 November 2026, at a Course not yet known to us, Georgia",
    );
  });

  it("says Course not yet known when no course is matched, without location", () => {
    expect(formatDatesAndCourse("2026-11-18", "2026-11-23", null, null)).toBe(
      "18–23 November 2026, at a Course not yet known to us",
    );
  });
});

describe("isStale", () => {
  const now = new Date("2026-10-28T06:17:00Z");

  it("is not stale one day after the derive", () => {
    expect(isStale("2026-10-27T06:17:00Z", now)).toBe(false);
  });

  it("is not stale exactly two days after the derive", () => {
    expect(isStale("2026-10-26T06:17:00Z", now)).toBe(false);
  });

  it("is stale two days and one minute after the derive", () => {
    expect(isStale("2026-10-26T06:16:00Z", now)).toBe(true);
  });

  it("reads null as stale, and never throws", () => {
    expect(isStale(null, now)).toBe(true);
    expect(formatFreshnessDate(null)).toBe("never");
  });
});

describe("formatFreshnessDate", () => {
  it("states the calendar date in UTC", () => {
    expect(formatFreshnessDate("2026-10-28T06:17:00Z")).toBe("28 Oct 2026");
  });
});
