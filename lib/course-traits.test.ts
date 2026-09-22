// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { CourseHole, CourseTee } from "../db/schema";
import augusta from "./opengolfapi/fixtures/augusta-national.detail.json";
import { toCourseRow } from "./opengolfapi/ingest";
import { courseResponse, parse } from "./opengolfapi/schema";
import { deriveCourseTraits, type CourseFacts } from "./course-traits";

const tee = (overrides: Partial<CourseTee> = {}): CourseTee => ({
  name: "Black",
  gender: "Male",
  par: 72,
  yardage: 6970,
  rating: 73.5,
  slope: 135,
  ...overrides,
});

const PAR_5_YARDAGES = [550, 530, 520, 500];
const PAR_4_YARDAGES = [450, 440, 430, 420, 410, 400, 390, 380, 370, 360];
const PAR_3_YARDAGES = [220, 210, 200, 190];

/** Eighteen holes: four par 5s, ten par 4s, four par 3s, summing to 6,970 at tee `black`. */
function trustedHoles(): CourseHole[] {
  const spec = [
    ...PAR_5_YARDAGES.map((yardage) => ({ par: 5, yardage })),
    ...PAR_4_YARDAGES.map((yardage) => ({ par: 4, yardage })),
    ...PAR_3_YARDAGES.map((yardage) => ({ par: 3, yardage })),
  ];
  return spec.map((h, i) => ({ number: i + 1, par: h.par, yardages: { black: h.yardage } }));
}

function trustedCourse(overrides: Partial<CourseFacts> = {}): CourseFacts {
  return {
    par: 72,
    publishedYardage: 6970,
    tees: [tee()],
    holes: trustedHoles(),
    holesCheckedTee: "black",
    holesTrusted: true,
    ...overrides,
  };
}

const byTrait = (traits: { trait: string }[], name: string) =>
  traits.find((t) => t.trait === name);

describe("deriveCourseTraits", () => {
  it("derives every Trait for a course with trusted holes", () => {
    const traits = deriveCourseTraits(trustedCourse());
    const names = traits.map((t) => t.trait).sort();

    expect(names).toEqual(
      [
        "length_yards",
        "par",
        "slope_rating_gap",
        "par_3_count",
        "par_4_count",
        "par_5_count",
        "par_5_share",
        "longest_par_4_yards",
        "mean_par_4_yards",
      ].sort(),
    );

    expect(byTrait(traits, "length_yards")).toMatchObject({ value: 6970, unit: "yards" });
    expect(byTrait(traits, "par")).toMatchObject({ value: 72, unit: "strokes" });
    expect(byTrait(traits, "slope_rating_gap")).toMatchObject({ value: 135 - 73.5, unit: "points" });
    expect(byTrait(traits, "par_3_count")).toMatchObject({ value: 4, unit: "holes" });
    expect(byTrait(traits, "par_4_count")).toMatchObject({ value: 10, unit: "holes" });
    expect(byTrait(traits, "par_5_count")).toMatchObject({ value: 4, unit: "holes" });
    expect(byTrait(traits, "par_5_share")).toMatchObject({ value: 4 / 18, unit: "share" });
    expect(byTrait(traits, "longest_par_4_yards")).toMatchObject({ value: 450, unit: "yards" });
    expect(byTrait(traits, "mean_par_4_yards")).toMatchObject({ value: 405, unit: "yards" });

    for (const t of traits) {
      expect(t.source).toBe("derived");
      expect(t.sourceUrl).toBeNull();
      expect(t.derivation.trim()).not.toBe("");
    }
  });

  it("tags every Trait with whether it came from trusted hole data or course-level data", () => {
    const traits = deriveCourseTraits(trustedCourse());
    const courseLevelNames = ["length_yards", "par", "slope_rating_gap"];
    const holeDerivedNames = [
      "par_3_count",
      "par_4_count",
      "par_5_count",
      "par_5_share",
      "longest_par_4_yards",
      "mean_par_4_yards",
    ];

    for (const name of courseLevelNames) {
      expect(byTrait(traits, name)?.derivation).toMatch(/course-level/);
    }
    for (const name of holeDerivedNames) {
      expect(byTrait(traits, name)?.derivation).toMatch(/trusted hole/);
    }
  });

  it("refuses every hole-derived Trait, and none of them fall back to a course-level number, when holes_trusted is false", () => {
    const traits = deriveCourseTraits(trustedCourse({ holesTrusted: false }));
    const names = traits.map((t) => t.trait).sort();

    expect(names).toEqual(["length_yards", "par", "slope_rating_gap"].sort());
  });

  it("refuses every hole-derived Trait when holes_trusted has never been checked", () => {
    const traits = deriveCourseTraits(
      trustedCourse({ holesTrusted: null, holes: null, holesCheckedTee: null }),
    );
    const names = traits.map((t) => t.trait).sort();

    expect(names).toEqual(["length_yards", "par", "slope_rating_gap"].sort());
  });

  it("refuses Augusta's hole-derived Traits, whose holes are 1,080 yards short of the card", () => {
    const course = parse(courseResponse, augusta, "fixture");
    const row = toCourseRow(course, "attribution");
    expect(row.holesTrusted).toBe(false);

    const traits = deriveCourseTraits(row);
    const names = traits.map((t) => t.trait).sort();
    expect(names).toEqual(["length_yards", "par", "slope_rating_gap"].sort());
    expect(byTrait(traits, "length_yards")?.value).toBe(7445);
  });

  it("yields the rest, not throwing, when a course has no tee matching the published yardage", () => {
    const traits = deriveCourseTraits(trustedCourse({ tees: [] }));
    expect(byTrait(traits, "slope_rating_gap")).toBeUndefined();
    expect(byTrait(traits, "length_yards")).toBeDefined();
    expect(byTrait(traits, "par_4_count")).toBeDefined();
  });

  it("yields the rest, not throwing, when the championship tee is missing slope or rating", () => {
    const traits = deriveCourseTraits(
      trustedCourse({ tees: [tee({ slope: null }), tee({ rating: null, yardage: 6970 })] }),
    );
    expect(byTrait(traits, "slope_rating_gap")).toBeUndefined();
    expect(byTrait(traits, "length_yards")).toBeDefined();
  });

  it("does not crash the mix calculation for a par 3 course, and omits the par-4 length Traits rather than dividing by zero", () => {
    const holes: CourseHole[] = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      par: 3,
      yardages: { black: 180 },
    }));
    const traits = deriveCourseTraits(
      trustedCourse({ holes, publishedYardage: 3240, par: 54, tees: [tee({ yardage: 3240 })] }),
    );

    expect(byTrait(traits, "par_3_count")).toMatchObject({ value: 18 });
    expect(byTrait(traits, "par_4_count")).toMatchObject({ value: 0 });
    expect(byTrait(traits, "par_5_count")).toMatchObject({ value: 0 });
    expect(byTrait(traits, "par_5_share")).toMatchObject({ value: 0 });
    expect(byTrait(traits, "longest_par_4_yards")).toBeUndefined();
    expect(byTrait(traits, "mean_par_4_yards")).toBeUndefined();
    for (const t of traits) expect(Number.isFinite(t.value)).toBe(true);
  });

  it("does not crash the mix calculation for a course with no par 5s", () => {
    const holes: CourseHole[] = trustedHoles().filter((h) => h.par !== 5);
    const traits = deriveCourseTraits(trustedCourse({ holes }));

    expect(byTrait(traits, "par_5_count")).toMatchObject({ value: 0 });
    expect(byTrait(traits, "par_5_share")).toMatchObject({ value: 0 });
    expect(byTrait(traits, "longest_par_4_yards")).toMatchObject({ value: 450 });
  });

  it("omits the par-4 length Traits, rather than computing them from a partial set, when a par 4 is missing a yardage at the checked tee", () => {
    const holes = trustedHoles();
    const firstFour = holes.find((h) => h.par === 4)!;
    firstFour.yardages = {};
    const traits = deriveCourseTraits(trustedCourse({ holes }));

    expect(byTrait(traits, "longest_par_4_yards")).toBeUndefined();
    expect(byTrait(traits, "mean_par_4_yards")).toBeUndefined();
    expect(byTrait(traits, "par_4_count")).toMatchObject({ value: 10 });
  });
});
