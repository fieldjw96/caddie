import { describe, expect, it } from "vitest";
import { centre, isInside, readPars, type OsmHole } from "./osm-holes";

const square = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 10 },
  { lat: 10, lon: 10 },
  { lat: 10, lon: 0 },
];

const line = (lat: number, lon: number) => [
  { lat, lon },
  { lat, lon },
];

const eighteen = (over: Partial<OsmHole> = {}): OsmHole[] =>
  Array.from({ length: 18 }, (_, i) => ({
    ref: String(i + 1),
    par: i === 0 ? "5" : "4",
    geometry: line(5, 5),
    ...over,
  }));

describe("isInside", () => {
  it("tells inside from outside", () => {
    expect(isInside({ lat: 5, lon: 5 }, [square])).toBe(true);
    expect(isInside({ lat: 15, lon: 5 }, [square])).toBe(false);
  });
});

describe("readPars", () => {
  it("reads a full 18, in hole order whatever order they came in", () => {
    const pars = readPars(eighteen().reverse(), [square]);
    expect(pars).toHaveLength(18);
    expect(pars![0]).toBe(5);
  });

  it("ignores a neighbouring Course's holes", () => {
    const neighbour = eighteen({ geometry: line(50, 50), par: "3" });
    expect(readPars([...eighteen(), ...neighbour], [square])![1]).toBe(4);
  });

  it("reads 7/18 as hole 7 and leaves a nine's 7/9 out", () => {
    const holes = eighteen().map((h) => ({ ...h, ref: `${h.ref}/18` }));
    const nine = Array.from({ length: 9 }, (_, i) => ({
      ref: `${i + 1}/9`,
      par: "3",
      geometry: line(5, 5),
    }));
    expect(readPars([...holes, ...nine], [square])![1]).toBe(4);
  });

  it.each([
    ["fewer than 18", eighteen().slice(1)],
    ["a hole number twice", [...eighteen(), eighteen()[0]!]],
    ["a hole with no par", eighteen({ par: undefined })],
    ["an impossible par", eighteen({ par: "9" })],
  ])("gives no card for %s", (_, holes) => {
    expect(readPars(holes, [square])).toBeNull();
  });
});

describe("centre", () => {
  it("is the middle of the bounds", () => {
    expect(centre([square])).toEqual({ lat: 5, lon: 5 });
  });
});
