import { describe, expect, it } from "vitest";
import {
  deriveStrengths,
  fieldsFromResults,
  FORM_WINDOW_DAYS,
  MINIMUM_SAMPLE,
  scoreResult,
  type Field,
  type StoredResult,
} from "./derive";
import { strengthRecords } from "./store";

const ASOF = "2025-09-01";
const AUGUSTA = 7;

function result(overrides: Partial<StoredResult> & { tournamentId: number }): StoredResult {
  return {
    playerId: 1,
    courseId: null,
    endDate: "2025-06-01",
    basis: "leaderboard",
    finish: "10",
    position: 10,
    ...overrides,
  };
}

/** `n` leaderboard finishes of 10th in 101-player fields, one per tournament from `from`. */
function tenths(n: number, from = 1, overrides: Partial<StoredResult> = {}): StoredResult[] {
  return Array.from({ length: n }, (_, i) => result({ tournamentId: from + i, ...overrides }));
}

/** Every tournament id in `rows` as a 101-player field with 70 finishers. */
function fieldsFor(rows: readonly StoredResult[]): Map<number, Field> {
  return new Map(rows.map((r) => [r.tournamentId, { size: 101, finishers: 70 }]));
}

function derive(rows: StoredResult[], courseId: number | null = null) {
  return deriveStrengths(rows, fieldsFor(rows), { asOf: ASOF, courseId });
}

describe("scoreResult", () => {
  it("makes a 10th in a 156-player field worth more than a 10th in a 30-player field", () => {
    const tenth = result({ tournamentId: 1 });
    expect(scoreResult(tenth, { size: 156, finishers: 70 })).toBeCloseTo(146 / 155);
    expect(scoreResult(tenth, { size: 30, finishers: 30 })).toBeCloseTo(20 / 29);
  });

  it("scores a win 1 and last place 0", () => {
    const field = { size: 30, finishers: 30 };
    expect(scoreResult(result({ tournamentId: 1, finish: "1", position: 1 }), field)).toBe(1);
    expect(scoreResult(result({ tournamentId: 1, finish: "30", position: 30 }), field)).toBe(
      0,
    );
  });

  it("ranks a missed cut tied behind every finisher", () => {
    const cut = result({ tournamentId: 1, finish: "CUT", position: null });
    expect(scoreResult(cut, { size: 156, finishers: 70 })).toBeCloseTo((156 - 71) / 155);
  });

  it("leaves a withdrawal, a disqualification and an unknown field out", () => {
    const field = { size: 156, finishers: 70 };
    for (const finish of ["WD", "DQ", "DNF", "DNS", "MDF"]) {
      expect(
        scoreResult(result({ tournamentId: 1, finish, position: null }), field),
      ).toBeNull();
    }
    expect(scoreResult(result({ tournamentId: 1 }), undefined)).toBeNull();
    expect(
      scoreResult(result({ tournamentId: 1, position: 1 }), { size: 1, finishers: 1 }),
    ).toBeNull();
  });
});

describe("fieldsFromResults", () => {
  it("estimates a field from every Player's rows, never below what they show", () => {
    const rows = [
      result({ playerId: 1, tournamentId: 1, finish: "1", position: 1 }),
      result({ playerId: 2, tournamentId: 1, finish: "T60", position: 60 }),
      result({ playerId: 3, tournamentId: 1, finish: "CUT", position: null }),
      result({ playerId: 4, tournamentId: 1, finish: "WD", position: null }),
      result({ playerId: 1, tournamentId: 2, finish: "3", position: 3 }),
    ];
    const fields = fieldsFromResults(rows);
    expect(fields.get(1)).toEqual({ size: 62, finishers: 60 });
    expect(fields.get(2)).toEqual({ size: 3, finishers: 3 });
  });

  it("counts rows when there are more of them than positions say", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      result({ playerId: i, tournamentId: 1, finish: "T1", position: 1 }),
    );
    expect(fieldsFromResults(rows).get(1)).toEqual({ size: 5, finishers: 5 });
  });
});

describe("deriveStrengths", () => {
  it("gives a Player with plenty of results a Skill, with the sample it rests on", () => {
    const { skill } = derive(tenths(12));
    expect(skill.value).toBeCloseTo(0.91);
    expect(skill.sampleSize).toBe(12);
    expect(skill.byBasis).toEqual({ leaderboard: 12, standings: 0 });
  });

  it("gives a Player with exactly the minimum a Skill", () => {
    const { skill } = derive(tenths(MINIMUM_SAMPLE));
    expect(skill.value).not.toBeNull();
    expect(skill.sampleSize).toBe(MINIMUM_SAMPLE);
  });

  it("gives a Player one below the minimum null, and still says how many there were", () => {
    const { skill } = derive(tenths(MINIMUM_SAMPLE - 1));
    expect(skill.value).toBeNull();
    expect(skill.sampleSize).toBe(MINIMUM_SAMPLE - 1);
    expect(skill.derivation).toContain(`fewer than the minimum of ${MINIMUM_SAMPLE}`);
  });

  it("gives a Player with no results nothing at all, and a sample of zero", () => {
    const strengths = derive([], AUGUSTA);
    for (const s of [strengths.skill, strengths.form, strengths.venueRecord]) {
      expect(s?.value).toBeNull();
      expect(s?.sampleSize).toBe(0);
    }
  });

  it("does not count a withdrawal towards the sample", () => {
    const rows = [
      ...tenths(MINIMUM_SAMPLE - 1),
      result({ tournamentId: 99, finish: "WD", position: null }),
    ];
    const { skill } = derive(rows);
    expect(skill.value).toBeNull();
    expect(skill.sampleSize).toBe(MINIMUM_SAMPLE - 1);
  });

  it("derives from a Player's standings rows alone, and says that is what they were", () => {
    const { skill } = derive(tenths(6, 1, { basis: "standings" }));
    expect(skill.value).toBeCloseTo(0.91);
    expect(skill.byBasis).toEqual({ leaderboard: 0, standings: 6 });
    expect(skill.derivation).toContain("0 from full-field leaderboards, 6 from the FedEx Cup");
  });

  it("weights a standings row and a leaderboard row alike", () => {
    const mixed = [
      ...tenths(3, 1),
      ...tenths(3, 10, { basis: "standings", finish: "51", position: 51 }),
    ];
    expect(derive(mixed).skill.value).toBeCloseTo((3 * 0.91 + 3 * 0.5) / 6);
  });

  it("gives a venue record to a Player with enough results at the Course", () => {
    const rows = [...tenths(MINIMUM_SAMPLE, 1, { courseId: AUGUSTA }), ...tenths(3, 20)];
    const { venueRecord } = derive(rows, AUGUSTA);
    expect(venueRecord?.value).toBeCloseTo(0.91);
    expect(venueRecord?.sampleSize).toBe(MINIMUM_SAMPLE);
    expect(venueRecord?.derivation).toContain(`course #${AUGUSTA}`);
  });

  it("gives a Player who has not played the Course no venue record", () => {
    const { skill, venueRecord } = derive(tenths(8, 1, { courseId: 3 }), AUGUSTA);
    expect(skill.value).not.toBeNull();
    expect(venueRecord?.value).toBeNull();
    expect(venueRecord?.sampleSize).toBe(0);
  });

  it("derives no venue record at all when there is no Course to hold one at", () => {
    expect(derive(tenths(8)).venueRecord).toBeNull();
  });

  it(`defines Form as events ending in the ${FORM_WINDOW_DAYS} days to the as-of date`, () => {
    const recent = tenths(MINIMUM_SAMPLE, 1, { endDate: "2025-03-06" });
    const stale = tenths(3, 20, { endDate: "2025-03-05" });
    const future = tenths(3, 30, { endDate: "2025-09-02" });
    const { form, skill } = derive([...recent, ...stale, ...future]);
    expect(form.sampleSize).toBe(MINIMUM_SAMPLE);
    expect(form.value).not.toBeNull();
    expect(skill.sampleSize).toBe(MINIMUM_SAMPLE + 3);

    const { form: thin } = derive([...recent.slice(1), ...stale]);
    expect(thin.value).toBeNull();
    expect(thin.sampleSize).toBe(MINIMUM_SAMPLE - 1);
  });

  it("names the tournaments a Strength came from in its derivation", () => {
    const { skill } = derive(tenths(MINIMUM_SAMPLE, 40));
    expect(skill.derivation).toContain("#40, #41, #42, #43, #44");
  });
});

describe("strengthRecords", () => {
  it("writes every Strength as derived, null ones included, with a derivation", () => {
    const derived = new Map([
      [1, derive(tenths(8), AUGUSTA)],
      [2, derive([], AUGUSTA)],
    ]);
    const records = strengthRecords(derived, AUGUSTA);
    expect(records).toHaveLength(6);
    expect(new Set(records.map((r) => r.strength))).toEqual(
      new Set(["skill", "form", `venue_record:course:${AUGUSTA}`]),
    );
    for (const record of records) {
      expect(record.source).toBe("derived");
      expect(record.derivation.trim()).not.toBe("");
    }
    expect(records.filter((r) => r.playerId === 2).every((r) => r.value === null)).toBe(true);
  });
});

/** A small seeded generator, so a failure reproduces from the seed it prints. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FINISH_LABELS = ["CUT", "MC", "WD", "DQ", "MDF"];

function generatedRows(random: () => number): StoredResult[] {
  const int = (max: number) => Math.floor(random() * max);
  const rows: StoredResult[] = [];
  const players = 1 + int(12);
  const tournaments = 1 + int(15);
  for (let t = 1; t <= tournaments; t++) {
    const courseId = random() < 0.2 ? null : 1 + int(3);
    const endDate = `2025-${String(1 + int(12)).padStart(2, "0")}-${String(1 + int(28)).padStart(2, "0")}`;
    for (let p = 1; p <= players; p++) {
      if (random() < 0.4) continue;
      const positioned = random() < 0.7;
      const position = positioned ? 1 + int(160) : null;
      rows.push({
        playerId: p,
        tournamentId: t,
        courseId,
        endDate,
        basis: random() < 0.5 ? "leaderboard" : "standings",
        finish: positioned
          ? String(position)
          : (FINISH_LABELS[int(FINISH_LABELS.length)] ?? "CUT"),
        position,
      });
    }
  }
  return rows;
}

describe("the minimum sample, over generated inputs", () => {
  it("never returns a Strength with a value and a sample below the minimum", () => {
    let valued = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const random = mulberry32(seed);
      const rows = generatedRows(random);
      const fields = fieldsFromResults(rows);
      const courseId = random() < 0.2 ? null : 1 + Math.floor(random() * 3);
      const playerIds = new Set(rows.map((r) => r.playerId));
      for (const playerId of playerIds) {
        const own = rows.filter((r) => r.playerId === playerId);
        const strengths = deriveStrengths(own, fields, { asOf: "2025-10-15", courseId });
        for (const s of [strengths.skill, strengths.form, strengths.venueRecord]) {
          if (s === null) continue;
          const context = `seed ${seed}, player ${playerId}, ${s.strength}`;
          expect(Number.isInteger(s.sampleSize), context).toBe(true);
          expect(s.sampleSize, context).toBe(s.byBasis.leaderboard + s.byBasis.standings);
          if (s.value === null) {
            expect(s.sampleSize < MINIMUM_SAMPLE, context).toBe(true);
          } else {
            valued += 1;
            expect(s.sampleSize, context).toBeGreaterThanOrEqual(MINIMUM_SAMPLE);
            expect(s.value, context).toBeGreaterThanOrEqual(0);
            expect(s.value, context).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    // A property that never met a valued Strength would pass by testing nothing.
    expect(valued).toBeGreaterThan(100);
  });
});
