import { describe, expect, it } from "vitest";
import { deriveCourseTraits } from "../course-traits";
import {
  DECLARED_CARDS,
  loadOsmCourses,
  planCourseCard,
  type DeclaredCard,
  type OsmCourse,
  type StoredCourseCard,
} from "./cards";

const stored = (over: Partial<StoredCourseCard> = {}): StoredCourseCard => ({
  id: 1,
  name: "A Course",
  publishedYardage: 7000,
  holes: null,
  holesSource: null,
  latitude: null,
  ...over,
});

const PARS = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];

const mapped: OsmCourse = {
  courseName: "A Course",
  osm: "way/123",
  latitude: 10,
  longitude: 20,
  pars: PARS,
};

const declared: DeclaredCard = {
  courseName: "A Course",
  sourceUrl: "https://example.com/card",
  tee: "Back",
  holes: PARS.map((par) => [par, 389] as const),
};

describe("planCourseCard", () => {
  it("never replaces the holes the row already has as its own", () => {
    const own = [{ number: 1, par: 4, yardages: { blue: 400 } }];
    const plan = planCourseCard(stored({ holes: own, latitude: 1 }), [declared], [mapped]);
    expect(plan).toBeNull();
  });

  it("gives OpenStreetMap's pars no yardages and so no yardage verdict", () => {
    const plan = planCourseCard(stored(), [], [mapped]);
    expect(plan?.card).toMatchObject({
      holesSource: "openstreetmap",
      holesSourceUrl: "https://www.openstreetmap.org/way/123",
      holesTrusted: null,
      holesCheckedTee: null,
    });
    expect(plan?.card?.holes.every((h) => Object.keys(h.yardages).length === 0)).toBe(true);
  });

  it("prefers a declared card, and checks it against the published total", () => {
    const plan = planCourseCard(stored(), [declared], [mapped]);
    expect(plan?.card).toMatchObject({
      holesSource: "declared",
      holesSourceUrl: "https://example.com/card",
      holesCheckedTee: "Back",
      holesYardageSum: 7002,
      holesYardageDifference: 2,
      holesTrusted: true,
    });
  });

  it("does not trust a declared card that disagrees with the published total", () => {
    const plan = planCourseCard(stored({ publishedYardage: 8000 }), [declared], []);
    expect(plan?.card?.holesTrusted).toBe(false);
  });

  it("writes a card from this stage again, in case it has changed", () => {
    const earlier = [{ number: 1, par: 4, yardages: {} }];
    const plan = planCourseCard(
      stored({ holes: earlier, holesSource: "openstreetmap" }),
      [],
      [mapped],
    );
    expect(plan?.card?.holes).toHaveLength(18);
  });

  it("takes coordinates from the map only where the row has none", () => {
    expect(planCourseCard(stored(), [], [mapped])?.coordinates).toEqual({
      latitude: 10,
      longitude: 20,
      coordinatesSource: "openstreetmap",
      coordinatesSourceUrl: "https://www.openstreetmap.org/way/123",
    });
    expect(planCourseCard(stored({ latitude: 1 }), [], [mapped])?.coordinates).toBeNull();
  });

  it("still gives coordinates for a mapped Course with no full set of holes", () => {
    const plan = planCourseCard(stored(), [], [{ ...mapped, pars: null }]);
    expect(plan?.card).toBeNull();
    expect(plan?.coordinates).not.toBeNull();
  });

  it("has nothing to say about a Course it does not know", () => {
    expect(planCourseCard(stored({ name: "Elsewhere" }), [declared], [mapped])).toBeNull();
  });
});

describe("the data as committed", () => {
  it("parses, and names each Course once", () => {
    const names = loadOsmCourses().map((c) => c.courseName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("holds El Cardonal's card as published: par 72, 7,363 yards, 36 and 36", () => {
    const card = DECLARED_CARDS.find((c) => c.courseName === "El Cardonal")!;
    expect(card.holes).toHaveLength(18);
    const sum = (i: 0 | 1, from = 0, to = 18) =>
      card.holes.slice(from, to).reduce((total, hole) => total + hole[i], 0);
    expect([sum(0, 0, 9), sum(0, 9, 18)]).toEqual([36, 36]);
    expect([sum(1, 0, 9), sum(1, 9, 18)]).toEqual([3785, 3578]);
  });

  it("gets El Cardonal every Trait a card can give", () => {
    const plan = planCourseCard(
      stored({ name: "El Cardonal", publishedYardage: 7363 }),
      DECLARED_CARDS,
      [],
    );
    const traits = deriveCourseTraits({
      par: 72,
      publishedYardage: 7363,
      tees: null,
      holes: plan!.card!.holes,
      holesCheckedTee: plan!.card!.holesCheckedTee,
      holesTrusted: plan!.card!.holesTrusted,
      altitude: null,
    });
    const value = (name: string) => traits.find((t) => t.trait === name)?.value;
    expect(value("par_5_count")).toBe(4);
    expect(value("par_3_count")).toBe(4);
    expect(value("par_4_count")).toBe(10);
    expect(value("longest_par_4_yards")).toBe(489);
  });
});
