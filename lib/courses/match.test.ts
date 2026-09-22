import { describe, expect, it } from "vitest";
import bayHill from "../opengolfapi/fixtures/bay-hill.search.json";
import {
  DECLARED_MATCHES,
  declaredFor,
  distinctiveWords,
  implausibleRecord,
  matchCourse,
  matchDeclared,
  normaliseName,
  scheduledCourses,
  searchQueries,
  stateCode,
  type Candidate,
} from "./match";

// Names and states are as OpenGolfAPI returned them on 2026-09-22; ids are placeholders.
const course = (id: string, course_name: string, state: string | null): Candidate => ({
  id,
  course_name,
  state,
});

/** `/v1/courses/search?q=Riviera Country Club`, unfiltered: three states read the same. */
const riviera = [
  course("r-fl", "Riviera Country Club", "FL"),
  course("r-wa", "Riviera Country Club", "WA"),
  course("r-ob", "Riviera Country Club (Ormond Beach)", "FL"),
  course("r-ca", "The Riviera Country Club", "CA"),
];

const bayHillCandidates: Candidate[] = bayHill.courses;

describe("stateCode", () => {
  it("reads a state as OpenGolfAPI writes it, and a country as no state", () => {
    expect(stateCode("California")).toBe("CA");
    expect(stateCode("North Carolina")).toBe("NC");
    expect(stateCode("Scotland")).toBeNull();
    expect(stateCode(null)).toBeNull();
  });
});

describe("scheduledCourses", () => {
  it("joins a club to the course in parentheses after it", () => {
    expect(scheduledCourses("TPC Sawgrass, (Stadium Course)")).toEqual([
      { club: "TPC Sawgrass", name: "TPC Sawgrass Stadium Course" },
    ]);
  });

  it("lists every course of an event played over several", () => {
    expect(
      scheduledCourses("Torrey Pines Golf Course, (South Course), (North Course)").map(
        (c) => c.name,
      ),
    ).toEqual([
      "Torrey Pines Golf Course South Course",
      "Torrey Pines Golf Course North Course",
    ]);
    expect(
      scheduledCourses(
        "La Quinta Country Club, PGA West, (Stadium Course), (Nicklaus Tournament Course)",
      ).map((c) => c.name),
    ).toEqual([
      "La Quinta Country Club",
      "PGA West Stadium Course",
      "PGA West Nicklaus Tournament Course",
    ]);
  });

  it("reads through a template and non-breaking spaces", () => {
    expect(
      scheduledCourses("{{nowrap|Pebble Beach Golf Links, Spyglass Hill Golf Course}}").map(
        (c) => c.name,
      ),
    ).toEqual(["Pebble Beach Golf Links", "Spyglass Hill Golf Course"]);
    expect(scheduledCourses("TPC Toronto at Osprey&nbsp;Valley (North&nbsp;course)")).toEqual([
      {
        club: "TPC Toronto at Osprey Valley",
        name: "TPC Toronto at Osprey Valley North course",
      },
    ]);
  });

  it("leaves a single club as it is", () => {
    expect(scheduledCourses("Black Desert Resort")).toEqual([
      { club: "Black Desert Resort", name: "Black Desert Resort" },
    ]);
  });
});

describe("normalising a name", () => {
  it("ignores case, accents and punctuation, and reads & as and", () => {
    expect(normaliseName("  Sedgefield Country Club, Ross-Course ")).toBe(
      "sedgefield country club ross course",
    );
    expect(normaliseName("Château & Golf")).toBe("chateau and golf");
  });

  it("drops the words that say what kind of place it is, and keeps the order of the rest", () => {
    expect(distinctiveWords("The Dunes Golf & Beach Club")).toEqual(["dunes", "beach"]);
    expect(distinctiveWords("Memorial Park Municipal Golf Course")).toEqual([
      "memorial",
      "park",
    ]);
  });

  it("searches by the club's first two distinctive words, then its first", () => {
    expect(searchQueries("Dunes Golf and Beach Club")).toEqual(["dunes beach", "dunes"]);
    expect(searchQueries("Waialae Country Club")).toEqual(["waialae"]);
  });
});

describe("matchCourse", () => {
  it("matches an exact name, among its neighbours", () => {
    const result = matchCourse(
      "Bay Hill Club Lodge Championship Course",
      "FL",
      bayHillCandidates,
      bayHill.total,
    );
    expect(result).toMatchObject({
      status: "matched",
      confidence: "exact",
      course: { id: "13fae2ba-51cf-436d-93da-2faa8cecc2c9" },
    });
  });

  it("matches ignoring case, punctuation and generic words, and says so", () => {
    const search = [
      course("tpc-rh", "Tpc River Highlands", "CT"),
      course("tpc-other", "Tpc Rivers Edge", "CT"),
    ];
    expect(matchCourse("TPC at River Highlands", "CT", search)).toMatchObject({
      status: "matched",
      confidence: "normalised",
      course: { id: "tpc-rh" },
    });
    expect(
      matchCourse("Shinnecock Hills Golf Club", "NY", [
        course("sh", "Shinnecock Hills Golf Course", "NY"),
      ]),
    ).toMatchObject({ status: "matched", confidence: "normalised" });
  });

  it("refuses a clearly different course, and lists what search returned", () => {
    const result = matchCourse("Bay Hill Club", "FL", bayHillCandidates, bayHill.total);
    expect(result.status).toBe("near-miss");
    if (result.status !== "near-miss") return;
    expect(result.reason).toMatch(/no course in FL reads as this name/);
    expect(result.candidates.map((c) => c.course_name)).toContain("Bay Hills Golf Club");
  });

  it("refuses to choose between two courses that read the same", () => {
    const result = matchCourse("Quail Hollow Club", "NC", [
      course("a", "Quail Hollow Golf Club", "NC"),
      course("b", "Quail Hollow Country Club", "NC"),
    ]);
    expect(result).toMatchObject({ status: "near-miss", reason: /2 courses read/ });
  });

  it("refuses when the courses with that exact name are all in other states", () => {
    expect(matchCourse("Riviera Country Club", "CA", riviera)).toMatchObject({
      status: "near-miss",
    });
    // Filtered to the state, as the ingest searches, the right one is the only one.
    expect(
      matchCourse(
        "Riviera Country Club",
        "CA",
        riviera.filter((c) => c.state === "CA"),
      ),
    ).toMatchObject({ status: "matched", confidence: "normalised", course: { id: "r-ca" } });
  });

  it("claims nothing from a page that is not the whole result", () => {
    expect(
      matchCourse(
        "Waialae Country Club",
        "HI",
        [course("w", "Waialae Country Club", "HI")],
        21,
      ),
    ).toMatchObject({ status: "near-miss", reason: /1 of 21 results/ });
  });

  it("matches abroad only a course with no state that nothing else reads as", () => {
    const birkdale = [
      course("rb", "Royal Birkdale Golf Club", null),
      course("b-va", "Birkdale Golf Club", "VA"),
    ];
    expect(matchCourse("Royal Birkdale Golf Club", null, birkdale)).toMatchObject({
      status: "matched",
      confidence: "exact",
      course: { id: "rb" },
    });

    const renaissance = [
      course("rc", "The Renaissance Club", null),
      course("r-ma", "Renaissance Golf Club", "MA"),
    ];
    expect(matchCourse("Renaissance Club", null, renaissance)).toMatchObject({
      status: "near-miss",
      reason: /2 courses read/,
    });
    expect(
      matchCourse("Renaissance Club", null, [course("r-ma", "Renaissance Golf Club", "MA")]),
    ).toMatchObject({ status: "near-miss", reason: /in MA, not outside the US/ });
  });
});

describe("declared matches", () => {
  it("are found by the schedule's name exactly as stored", () => {
    expect(declaredFor("Bay Hill Club and Lodge")?.name).toBe(
      "Bay Hill Club Lodge Championship Course",
    );
    expect(declaredFor("Bay Hill Club & Lodge")).toBeUndefined();
  });

  it("each name one schedule entry and a state OpenGolfAPI uses", () => {
    const schedules = DECLARED_MATCHES.map((d) => d.schedule);
    expect(new Set(schedules).size).toBe(schedules.length);
    for (const d of DECLARED_MATCHES) expect(d.state).toMatch(/^[A-Z]{2}$/);
  });

  it("are checked against the search like any other match", () => {
    const declared = declaredFor("Bay Hill Club and Lodge")!;
    expect(matchDeclared(declared, bayHillCandidates, bayHill.total)).toMatchObject({
      status: "matched",
      confidence: "declared",
      course: { id: "13fae2ba-51cf-436d-93da-2faa8cecc2c9" },
    });
    expect(
      matchDeclared(
        declared,
        bayHillCandidates.filter((c) => !c.course_name.includes("Championship")),
      ),
    ).toMatchObject({ status: "near-miss", reason: /was not in the search/ });
  });
});

describe("implausibleRecord", () => {
  it("refuses a record no Tour course could have, and passes a real one", () => {
    // OpenGolfAPI's Colonial Country Club, Fort Worth, as fetched on 2026-09-22.
    expect(implausibleRecord(58, 2194)).toMatch(/par 58/);
    expect(implausibleRecord(72, 5200)).toMatch(/5200 yards/);
    expect(implausibleRecord(72, 7445)).toBeNull();
    expect(implausibleRecord(null, null)).toBeNull();
  });
});
