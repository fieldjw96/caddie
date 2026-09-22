import { describe, expect, it } from "vitest";
import { finishSchema } from "./finish";
import { normaliseName, PlayerIndex, withoutDisambiguator } from "./names";

describe("normaliseName", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(normaliseName("J. T. Poston")).toBe(normaliseName("JT Poston"));
    expect(normaliseName("Ludvig Åberg")).toBe("ludvigaberg");
    expect(normaliseName("Niklas Nørgaard")).toBe("niklasnorgaard");
    expect(normaliseName("Kim Si-woo")).toBe(normaliseName("kim siwoo"));
  });

  it("does not make a first name out of an initial or reorder a name", () => {
    expect(normaliseName("Matt Fitzpatrick")).not.toBe(normaliseName("Matthew Fitzpatrick"));
    expect(normaliseName("Kim Si-woo")).not.toBe(normaliseName("Si Woo Kim"));
  });
});

describe("withoutDisambiguator", () => {
  it("drops Wikipedia's trailing parenthetical", () => {
    expect(withoutDisambiguator("Matt McCarty (golfer)")).toBe("Matt McCarty");
    expect(withoutDisambiguator("Rory McIlroy")).toBe("Rory McIlroy");
  });
});

describe("PlayerIndex", () => {
  const index = new PlayerIndex([
    { id: 1, name: "Ludvig Åberg" },
    { id: 2, name: "Michael Kim" },
    { id: 3, name: "Michael Kim" },
    { id: 4, name: "Tom Kim" },
  ]);

  it("matches exactly after normalisation", () => {
    expect(index.match(["ludvig aberg"])).toEqual({ kind: "matched", playerId: 1 });
  });

  it("reports a name that matches nobody", () => {
    expect(index.match(["Matt Fitzpatrick"])).toEqual({ kind: "unmatched" });
  });

  it("refuses to choose between two players sharing a name", () => {
    expect(index.match(["Michael Kim"])).toEqual({ kind: "ambiguous", playerIds: [2, 3] });
  });

  it("tries candidates in order and stops at the first that finds anyone", () => {
    expect(index.match(["Joohyung Kim", "Tom Kim"])).toEqual({ kind: "matched", playerId: 4 });
    expect(index.match(["Michael Kim", "Tom Kim"]).kind).toBe("ambiguous");
  });
});

describe("finishSchema", () => {
  it("reads positions, ties and the no-position labels", () => {
    expect(finishSchema.parse("7")).toEqual({ finish: "7", position: 7 });
    expect(finishSchema.parse("T14")).toEqual({ finish: "T14", position: 14 });
    expect(finishSchema.parse("'''1'''")).toEqual({ finish: "1", position: 1 });
    expect(finishSchema.parse("[[Charles Schwab Challenge|T4]]")).toEqual({
      finish: "T4",
      position: 4,
    });
    expect(finishSchema.parse("{{tooltip|WD|Withdrew}}")).toEqual({
      finish: "WD",
      position: null,
    });
    expect(finishSchema.parse("CUT")).toEqual({ finish: "CUT", position: null });
  });

  it("refuses anything else rather than guessing a position", () => {
    for (const cell of ["", "0", "T0", "•", "Top 5", "1st"]) {
      expect(finishSchema.safeParse(cell).success).toBe(false);
    }
  });
});
