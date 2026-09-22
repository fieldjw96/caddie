import { describe, expect, it } from "vitest";
import { MINIMUM_SAMPLE } from "./derive";
import {
  countedRounds,
  deriveRoundStrengths,
  isLowRound,
  MINIMUM_ROUND_FIELD,
  rawRoundMeasures,
  roundFields,
  shareBeaten,
  type RoundedResult,
  type RoundScores,
} from "./rounds";
import { strengthRecords } from "./store";

const ASOF = "2026-09-01";

function rounded(
  overrides: Partial<RoundedResult> & { tournamentId: number; rounds: RoundScores },
): RoundedResult {
  return {
    playerId: 1,
    courseId: null,
    endDate: "2026-06-01",
    basis: "leaderboard",
    finish: "10",
    position: 10,
    ...overrides,
  };
}

/**
 * A background field of `size` Players, ids from 100, in tournament `t`: every round has a
 * spread of scores from 66 to 74, shuffled differently by round so nobody is steady by design.
 */
function background(t: number, size = 20): RoundedResult[] {
  return Array.from({ length: size }, (_, i) =>
    rounded({
      playerId: 100 + i,
      tournamentId: t,
      finish: String(i + 1),
      position: i + 1,
      rounds: [0, 1, 2, 3].map((r) => 66 + ((i * (r + 3) + r) % 9)) as unknown as RoundScores,
    }),
  );
}

describe("countedRounds", () => {
  it("counts all four rounds of a finisher", () => {
    expect(countedRounds(rounded({ tournamentId: 1, rounds: [70, 71, 72, 73] }))).toEqual([
      { round: 1, strokes: 70 },
      { round: 2, strokes: 71 },
      { round: 3, strokes: 72 },
      { round: 4, strokes: 73 },
    ]);
  });

  it("leaves out a round the Source printed no score for, and fills nothing in", () => {
    const missing = rounded({ tournamentId: 1, rounds: [70, null, 72, 73] });
    expect(countedRounds(missing).map((r) => r.round)).toEqual([1, 3, 4]);
    // A line whose score cell did not add up is stored with no rounds at all.
    const typo = rounded({ tournamentId: 1, rounds: [null, null, null, null] });
    expect(countedRounds(typo)).toEqual([]);
  });

  it("counts a missed cut as two rounds, not four", () => {
    for (const finish of ["CUT", "MC"]) {
      const cut = rounded({
        tournamentId: 1,
        finish,
        position: null,
        rounds: [75, 76, null, null],
      });
      expect(countedRounds(cut), finish).toEqual([
        { round: 1, strokes: 75 },
        { round: 2, strokes: 76 },
      ]);
    }
    // Even were a weekend score stored against a missed cut, it is not read.
    const odd = rounded({
      tournamentId: 1,
      finish: "CUT",
      position: null,
      rounds: [75, 76, 70, 70],
    });
    expect(countedRounds(odd)).toHaveLength(2);
  });

  it("counts no rounds from a withdrawal", () => {
    const wd = rounded({
      tournamentId: 1,
      finish: "WD",
      position: null,
      rounds: [80, null, null, null],
    });
    expect(countedRounds(wd)).toEqual([]);
  });

  it("counts no rounds from a disqualification, or any other non-finish", () => {
    for (const finish of ["DQ", "DNF", "DNS", "MDF"]) {
      const row = rounded({
        tournamentId: 1,
        finish,
        position: null,
        rounds: [70, 70, 70, null],
      });
      expect(countedRounds(row), finish).toEqual([]);
    }
  });

  it("counts no rounds from a standings row", () => {
    const row = rounded({
      tournamentId: 1,
      basis: "standings",
      rounds: [null, null, null, null],
    });
    expect(countedRounds(row)).toEqual([]);
  });
});

describe("roundFields", () => {
  it("builds each round's field from the rounds that count", () => {
    const rows = background(1);
    const fields = roundFields(rows);
    expect([...fields.keys()].sort()).toEqual(["1:1", "1:2", "1:3", "1:4"]);
    expect(fields.get("1:1")!.scores).toHaveLength(20);
  });

  it("leaves a withdrawal's and a missed cut's weekend out of the field", () => {
    const rows = [
      ...background(1),
      rounded({
        playerId: 2,
        tournamentId: 1,
        finish: "WD",
        position: null,
        rounds: [90, null, null, null],
      }),
      rounded({
        playerId: 3,
        tournamentId: 1,
        finish: "CUT",
        position: null,
        rounds: [80, 80, 60, 60],
      }),
    ];
    const fields = roundFields(rows);
    expect(fields.get("1:1")!.scores).toHaveLength(21);
    expect(fields.get("1:1")!.scores).not.toContain(90);
    expect(fields.get("1:3")!.scores).toHaveLength(20);
  });

  it("refuses a round with too few scores, or none different, to stand against", () => {
    const small = background(1, MINIMUM_ROUND_FIELD - 1);
    expect(roundFields(small).size).toBe(0);
    const flat = Array.from({ length: 20 }, (_, i) =>
      rounded({ playerId: i, tournamentId: 1, rounds: [70, 70, 70, 70] }),
    );
    expect(roundFields(flat).size).toBe(0);
  });
});

describe("isLowRound", () => {
  it("takes the lowest tenth of the field, ties at the edge included", () => {
    const field = {
      scores: [64, 65, 65, 66, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 71],
      mean: 69.5,
      sd: 1.9,
    };
    // Twenty scores: the lowest two places. 65 is tied for second, so both 65s are low.
    expect(isLowRound(64, field)).toBe(true);
    expect(isLowRound(65, field)).toBe(true);
    expect(isLowRound(66, field)).toBe(false);
  });
});

describe("rawRoundMeasures", () => {
  it("tells 70-70-71-70 from 66-75-68-73, the same total", () => {
    const rows = [...background(1)];
    const steady = rounded({ playerId: 1, tournamentId: 1, rounds: [70, 70, 71, 70] });
    const streaky = rounded({ playerId: 2, tournamentId: 1, rounds: [66, 75, 68, 73] });
    const fields = roundFields([...rows, steady, streaky]);
    const a = rawRoundMeasures([steady], fields);
    const b = rawRoundMeasures([streaky], fields);
    expect(a.rounds).toBe(4);
    expect(a.spread!).toBeLessThan(b.spread!);
    expect(a.lowRate).toBe(0);
    expect(b.lowRate!).toBeGreaterThan(0);
  });

  it("sets each round against its own field, so a hard day does not read as erratic", () => {
    // Everyone scores eight more on round 2: a Player who does the same is steady, not wild.
    const windy = background(1).map((r) => ({
      ...r,
      rounds: [r.rounds[0], r.rounds[1]! + 8, r.rounds[2], r.rounds[3]] as RoundScores,
    }));
    const player = rounded({ playerId: 1, tournamentId: 1, rounds: [70, 78, 70, 70] });
    const calm = rounded({ playerId: 1, tournamentId: 1, rounds: [70, 70, 70, 70] });
    const inWind = rawRoundMeasures([player], roundFields([...windy, player]));
    const inCalm = rawRoundMeasures([calm], roundFields([...background(1), calm]));
    expect(inWind.spread!).toBeCloseTo(inCalm.spread!, 1);
  });

  it("counts a missed cut as its two rounds and an event, and a withdrawal as nothing", () => {
    const rows = [...background(1), ...background(2)];
    const cut = rounded({
      playerId: 1,
      tournamentId: 1,
      finish: "CUT",
      position: null,
      rounds: [76, 77, null, null],
    });
    const wd = rounded({
      playerId: 1,
      tournamentId: 2,
      finish: "WD",
      position: null,
      rounds: [79, null, null, null],
    });
    const m = rawRoundMeasures([cut, wd], roundFields([...rows, cut, wd]));
    expect(m.rounds).toBe(2);
    expect(m.events).toBe(1);
    expect(m.tournamentIds).toEqual([1]);
  });
});

describe("shareBeaten", () => {
  it("counts a tie as half, and has nothing to say with nobody to beat", () => {
    expect(shareBeaten(1, [2, 1, 0.5, 3], "lower")).toBeCloseTo(2.5 / 4);
    expect(shareBeaten(1, [2, 1, 0.5, 3], "higher")).toBeCloseTo(1.5 / 4);
    expect(shareBeaten(1, [], "lower")).toBeNull();
  });
});

/** `events` tournaments from `from`, each with a background field and Player 1 and Player 2 in it. */
function season(events: number, from = 1): RoundedResult[] {
  const rows: RoundedResult[] = [];
  for (let t = from; t < from + events; t++) {
    rows.push(...background(t));
    rows.push(rounded({ playerId: 1, tournamentId: t, rounds: [70, 70, 71, 70] }));
    rows.push(rounded({ playerId: 2, tournamentId: t, rounds: [64, 76, 65, 75] }));
  }
  return rows;
}

describe("deriveRoundStrengths", () => {
  it("states both Strengths, field-relative, once a Player has enough events", () => {
    const derived = deriveRoundStrengths(season(MINIMUM_SAMPLE), ASOF, [1, 2]);
    const steady = derived.get(1)!;
    const streaky = derived.get(2)!;
    expect(steady.consistency.sampleSize).toBe(MINIMUM_SAMPLE);
    expect(steady.consistency.value).not.toBeNull();
    expect(steady.consistency.value!).toBeGreaterThan(streaky.consistency.value!);
    expect(streaky.lowRounds.value!).toBeGreaterThan(steady.lowRounds.value!);
    for (const s of [steady.consistency, steady.lowRounds]) {
      expect(s.value!).toBeGreaterThanOrEqual(0);
      expect(s.value!).toBeLessThanOrEqual(1);
      expect(s.derivation).toMatch(/CC BY-SA 4\.0/);
    }
  });

  it("is null below the minimum sample, and still carries the sample", () => {
    const derived = deriveRoundStrengths(season(MINIMUM_SAMPLE - 1), ASOF, [1, 2, 999]);
    for (const id of [1, 2]) {
      const s = derived.get(id)!;
      expect(s.consistency.value).toBeNull();
      expect(s.lowRounds.value).toBeNull();
      expect(s.consistency.sampleSize).toBe(MINIMUM_SAMPLE - 1);
      expect(s.consistency.derivation).toMatch(/fewer than the minimum of 5 events/);
    }
    // A Player with no rows at all is answered, with a sample of zero, not left out.
    expect(derived.get(999)!.consistency).toMatchObject({ value: null, sampleSize: 0 });
  });

  it("counts events, not rounds, towards the minimum: five missed cuts are five events", () => {
    const rows: RoundedResult[] = [];
    for (let t = 1; t <= MINIMUM_SAMPLE; t++) {
      rows.push(...background(t));
      rows.push(
        rounded({
          playerId: 1,
          tournamentId: t,
          finish: "CUT",
          position: null,
          rounds: [75, 74, null, null],
        }),
      );
    }
    const s = deriveRoundStrengths(rows, ASOF, [1, 100]).get(1)!;
    expect(s.consistency.sampleSize).toBe(MINIMUM_SAMPLE);
    expect(s.consistency.value).not.toBeNull();
    expect(s.consistency.derivation).toMatch(/\(10 rounds\)/);
  });

  it("ignores events after the as-of date", () => {
    const rows = season(MINIMUM_SAMPLE).map((r) =>
      r.tournamentId === 1 ? { ...r, endDate: "2026-12-01" } : r,
    );
    expect(deriveRoundStrengths(rows, ASOF, [1]).get(1)!.consistency.sampleSize).toBe(
      MINIMUM_SAMPLE - 1,
    );
  });

  it("has no value for a lone qualifier, with nobody to set against", () => {
    const rows = season(MINIMUM_SAMPLE);
    const s = deriveRoundStrengths(rows, ASOF, [1]).get(1)!;
    expect(s.consistency.value).toBeNull();
    expect(s.consistency.derivation).toMatch(/no other Player/);
  });

  it("is stored beside the other Strengths, Derived, null values included", () => {
    const fromRounds = deriveRoundStrengths(season(2), ASOF, [1]);
    const skillless = {
      skill: {
        strength: "skill" as const,
        value: null,
        sampleSize: 0,
        byBasis: { leaderboard: 0, standings: 0 },
        tournamentIds: [],
        derivation: "skill: none",
      },
      form: {
        strength: "form" as const,
        value: null,
        sampleSize: 0,
        byBasis: { leaderboard: 0, standings: 0 },
        tournamentIds: [],
        derivation: "form: none",
      },
      venueRecord: null,
    };
    const records = strengthRecords(new Map([[1, skillless]]), null, fromRounds);
    expect(records.map((r) => r.strength).sort()).toEqual([
      "consistency",
      "form",
      "low_rounds",
      "skill",
    ]);
    expect(records.find((r) => r.strength === "consistency")).toMatchObject({
      value: null,
      sampleSize: 2,
      source: "derived",
    });
  });
});
