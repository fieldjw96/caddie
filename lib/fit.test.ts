import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTINGS,
  FIT_TRAITS,
  fitScore,
  normalise,
  rankFits,
  TRAIT_SCALES,
  type FitCourseTraits,
  type FitPlayerStrengths,
  type FitTraitName,
  type Weightings,
} from "./fit";

describe("normalise", () => {
  it("places a value within its range", () => {
    expect(normalise(5, 0, 10)).toBe(0.5);
    expect(normalise(0, 0, 10)).toBe(0);
    expect(normalise(10, 0, 10)).toBe(1);
  });

  it("clamps outside the range rather than extrapolating", () => {
    expect(normalise(-5, 0, 10)).toBe(0);
    expect(normalise(15, 0, 10)).toBe(1);
  });

  it("returns the midpoint when a trait cannot separate anyone", () => {
    expect(normalise(7, 7, 7)).toBe(0.5);
  });

  it("refuses a range that runs backwards", () => {
    expect(() => normalise(5, 10, 0)).toThrow(RangeError);
  });

  it("refuses values that are not finite", () => {
    expect(() => normalise(Number.NaN, 0, 10)).toThrow(RangeError);
    expect(() => normalise(5, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

/** Every relative module fit.ts reaches, and every bare specifier any of them imports. */
function importGraph(entry: string): { files: string[]; external: string[] } {
  const files: string[] = [];
  const external = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.includes(file)) continue;
    files.push(file);
    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ].map((m) => m[1]!);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) pending.push(`${resolve(dirname(file), specifier)}.ts`);
      else external.add(specifier);
    }
  }
  return { files, external: [...external] };
}

describe("the module's import graph", () => {
  const graph = importGraph(resolve(__dirname, "fit.ts"));

  it("imports no database client, no next/*, and nothing else outside itself", () => {
    expect(graph.external).toEqual([]);
    expect(graph.files.every((f) => !/[\\/]db[\\/]/.test(f))).toBe(true);
  });

  it("makes no network call", () => {
    for (const file of graph.files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    }
  });
});

describe("DEFAULT_WEIGHTINGS", () => {
  it("adds up to 1", () => {
    const total = FIT_TRAITS.reduce((sum, t) => sum + DEFAULT_WEIGHTINGS[t], 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it("weighs every Trait the score reads, and only those", () => {
    expect(Object.keys(DEFAULT_WEIGHTINGS).sort()).toEqual([...FIT_TRAITS].sort());
  });

  it("carries a comment on every Weighting", () => {
    const source = readFileSync(resolve(__dirname, "fit.ts"), "utf8");
    const block = source.slice(source.indexOf("export const DEFAULT_WEIGHTINGS"));
    const body = block.slice(0, block.indexOf("};"));
    for (const trait of FIT_TRAITS) {
      expect(body, trait).toMatch(new RegExp(`//[^\\n]*\\n\\s*${trait}:`));
    }
  });
});

// A long, penal course with plenty of par 5s: asks the most of every Trait.
const SUITING: FitCourseTraits = {
  length_yards: 7_800,
  slope_rating_gap: 80,
  mean_par_4_yards: 480,
  longest_par_4_yards: 540,
  par_5_share: 5 / 18,
};
// A short, gentle par 70: asks the least of every Trait.
const NOT_SUITING: FitCourseTraits = {
  length_yards: 6_900,
  slope_rating_gap: 60,
  mean_par_4_yards: 400,
  longest_par_4_yards: 460,
  par_5_share: 2 / 18,
};
const STRONG: FitPlayerStrengths = { skill: 0.8, consistency: 0.75, low_rounds: 0.75 };

describe("which Strength each Trait calls for", () => {
  it("does not map every Trait to the same Strength", () => {
    const called = new Set(FIT_TRAITS.map((t) => TRAIT_SCALES[t].calls));
    expect(called.size).toBeGreaterThan(1);
  });

  it("has at least two Traits calling for something other than Skill", () => {
    const notSkill = FIT_TRAITS.filter((t) => TRAIT_SCALES[t].calls !== "skill");
    expect(notSkill.length).toBeGreaterThanOrEqual(2);
  });

  it("declares the mapping, and a reason for each Trait the page can print", () => {
    expect(Object.fromEntries(FIT_TRAITS.map((t) => [t, TRAIT_SCALES[t].calls]))).toEqual({
      length_yards: "skill",
      slope_rating_gap: "consistency",
      mean_par_4_yards: "skill",
      longest_par_4_yards: "skill",
      par_5_share: "low_rounds",
    });
    for (const trait of FIT_TRAITS) expect(TRAIT_SCALES[trait].why.trim(), trait).not.toBe("");
  });

  it("scores Players with the same Skill differently where the Course asks for a kind of game", () => {
    const steady = { skill: 0.7, consistency: 0.9, low_rounds: 0.2 };
    const streaky = { skill: 0.7, consistency: 0.2, low_rounds: 0.9 };
    const penal: FitCourseTraits = { slope_rating_gap: 80, par_5_share: 2 / 18 };
    const scoring: FitCourseTraits = { slope_rating_gap: 60, par_5_share: 5 / 18 };
    expect(fitScore(penal, steady).score!).toBeGreaterThan(fitScore(penal, streaky).score!);
    expect(fitScore(scoring, streaky).score!).toBeGreaterThan(
      fitScore(scoring, steady).score!,
    );
  });
});

describe("fitScore", () => {
  it("scores a strong Player well at a Course that suits them", () => {
    const fit = fitScore(SUITING, STRONG);
    // Every Trait at the top of its range: the score is the weighted edge, all of it known.
    expect(fit.score).toBeCloseTo(0.55 * 0.6 + 0.25 * 0.5 + 0.2 * 0.5, 12);
    expect(fit.knownWeight).toBeCloseTo(1, 12);
    expect(fit.totalWeight).toBeCloseTo(1, 12);
  });

  it("scores the same Player at zero at a Course that asks nothing of them", () => {
    const fit = fitScore(NOT_SUITING, STRONG);
    expect(fit.score).toBe(0);
    // Known, and zero because the Course asks nothing: not the same as unknown.
    expect(fit.components.every((c) => c.contribution === 0)).toBe(true);
    expect(fit.knownWeight).toBeCloseTo(1, 12);
    expect(fitScore(NOT_SUITING, STRONG).score!).toBeLessThan(
      fitScore(SUITING, STRONG).score!,
    );
  });

  it("breaks out every Trait's working so the page need not recompute it", () => {
    const fit = fitScore({ ...SUITING, length_yards: 7_350 }, STRONG);
    const length = fit.components.find((c) => c.trait === "length_yards")!;
    expect(length).toEqual({
      trait: "length_yards",
      traitValue: 7_350,
      range: { min: 6_900, max: 7_800 },
      normalised: 0.5,
      weight: 0.3,
      strength: "skill",
      strengthValue: 0.8,
      edge: expect.closeTo(0.6, 12),
      contribution: expect.closeTo(0.3 * 0.5 * 0.6, 12),
    });
    const sum = fit.components.reduce((s, c) => s + (c.contribution ?? 0), 0);
    expect(fit.score).toBeCloseTo(sum, 12);
  });

  it("gives a null Strength a null contribution, never zero", () => {
    const fit = fitScore(SUITING, { skill: 0.8, low_rounds: null });
    const par5 = fit.components.find((c) => c.trait === "par_5_share")!;
    expect(par5.strengthValue).toBeNull();
    expect(par5.edge).toBeNull();
    expect(par5.contribution).toBeNull();
    expect(par5.contribution).not.toBe(0);
    // And it is not scored as a zero Strength, which would be the worst finish possible.
    const asZero = fitScore(SUITING, { skill: 0.8, low_rounds: 0 });
    expect(asZero.components.find((c) => c.trait === "par_5_share")!.contribution).toBe(-0.2);
    expect(fit.score).not.toBe(asZero.score);
  });

  it("scores a Player with partial Strengths on what is known, and says how much that is", () => {
    const fit = fitScore(SUITING, { skill: null, low_rounds: 0.75 });
    expect(fit.score).toBeCloseTo(0.2 * 1 * 0.5, 12);
    expect(fit.knownWeight).toBeCloseTo(0.2, 12);
    expect(fit.totalWeight).toBeCloseTo(1, 12);
    const unknown = fit.components.filter((c) => c.contribution === null).map((c) => c.trait);
    expect(unknown.sort()).toEqual(
      ["length_yards", "longest_par_4_yards", "mean_par_4_yards", "slope_rating_gap"].sort(),
    );
  });

  it("gives a Player with no Strengths a null Fit Score, not zero", () => {
    for (const none of [
      {},
      { skill: null, consistency: null, low_rounds: null },
    ] as FitPlayerStrengths[]) {
      const fit = fitScore(SUITING, none);
      expect(fit.score).toBeNull();
      expect(fit.knownWeight).toBe(0);
      expect(fit.components.every((c) => c.contribution === null)).toBe(true);
    }
  });

  it("leaves a Trait the Course is missing, as for untrusted hole data, unknown", () => {
    // What lib/course-traits.ts yields for Augusta: its holes failed the check, so every Trait
    // built on them is absent, and only the card's own figures remain.
    const augusta: FitCourseTraits = { length_yards: 7_445, slope_rating_gap: 148 - 76.2 };
    const fit = fitScore(augusta, STRONG);
    for (const trait of ["mean_par_4_yards", "longest_par_4_yards", "par_5_share"] as const) {
      const c = fit.components.find((x) => x.trait === trait)!;
      expect(c.traitValue, trait).toBeNull();
      expect(c.normalised, trait).toBeNull();
      expect(c.contribution, trait).toBeNull();
    }
    expect(fit.knownWeight).toBeCloseTo(0.55, 12);
    expect(fit.score).toBeCloseTo(
      0.3 * ((7_445 - 6_900) / 900) * 0.6 + 0.25 * ((71.8 - 60) / 20) * 0.5,
      12,
    );
    // A null Trait is the same as an absent one.
    expect(fitScore({ ...augusta, par_5_share: null }, STRONG)).toEqual(fit);
  });

  it("gives a null Fit Score for a Course with no Trait it can read", () => {
    expect(fitScore({}, STRONG).score).toBeNull();
  });

  it("takes the Weightings as an argument", () => {
    const lengthOnly: Weightings = {
      length_yards: 1,
      slope_rating_gap: 0,
      mean_par_4_yards: 0,
      longest_par_4_yards: 0,
      par_5_share: 0,
    };
    expect(fitScore(SUITING, STRONG, lengthOnly).score).toBeCloseTo(0.6, 12);
    expect(fitScore(SUITING, STRONG).score).toBeCloseTo(0.555, 12);
  });

  it("refuses Weightings and Strengths it cannot mean anything by", () => {
    const bad = { ...DEFAULT_WEIGHTINGS, par_5_share: -0.1 };
    expect(() => fitScore(SUITING, STRONG, bad)).toThrow(/par_5_share/);
    const nan = { ...DEFAULT_WEIGHTINGS, length_yards: Number.NaN };
    expect(() => fitScore(SUITING, STRONG, nan)).toThrow(/length_yards/);
    expect(() => fitScore(SUITING, { skill: 1.2 })).toThrow(/skill/);
    expect(() => fitScore({ length_yards: Number.NaN }, STRONG)).toThrow(RangeError);
  });
});

describe("rankFits", () => {
  it("ranks the scored highest first and keeps the unscored apart, not at the bottom", () => {
    const players = [
      {
        player: "weak",
        fit: fitScore(SUITING, { skill: 0.3, consistency: 0.3, low_rounds: 0.3 }),
      },
      { player: "unknown", fit: fitScore(SUITING, {}) },
      { player: "strong", fit: fitScore(SUITING, STRONG) },
    ];
    const ranked = rankFits(players);
    expect(ranked.scored.map((r) => r.player)).toEqual(["strong", "weak"]);
    expect(ranked.unscored.map((r) => r.player)).toEqual(["unknown"]);
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

function generated(random: () => number) {
  const maybe = <T>(value: T, pNull = 0.2): T | null => (random() < pNull ? null : value);
  const traits: Partial<Record<FitTraitName, number | null>> = {};
  for (const trait of FIT_TRAITS) {
    const { min, max } = TRAIT_SCALES[trait];
    // Some beyond the range on either side, to exercise the clamp.
    const value = min + (max - min) * (random() * 1.4 - 0.2);
    if (random() < 0.15) continue;
    traits[trait] = maybe(value, 0.1);
  }
  const weightings = Object.fromEntries(
    FIT_TRAITS.map((t) => [t, random() < 0.1 ? 0 : random() * 3]),
  ) as Record<FitTraitName, number>;
  const player = (): FitPlayerStrengths => ({
    skill: maybe(random()),
    consistency: maybe(random()),
    low_rounds: maybe(random()),
  });
  return { traits, weightings, a: player(), b: player() };
}

const SEEDS = 1_000;

describe("fitScore, as properties over generated inputs", () => {
  it("never lowers the score of a Player above average on a Trait when its weight rises", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const random = mulberry32(seed);
      const { traits, weightings, a } = generated(random);
      const before = fitScore(traits, a, weightings);
      for (const trait of FIT_TRAITS) {
        const c = before.components.find((x) => x.trait === trait)!;
        if (c.strengthValue === null || c.strengthValue <= 0.5) continue;
        const raised = { ...weightings, [trait]: weightings[trait] + 0.01 + random() * 2 };
        const after = fitScore(traits, a, raised);
        if (before.score === null) continue;
        expect(after.score, `seed ${seed}, ${trait}`).not.toBeNull();
        expect(after.score! - before.score, `seed ${seed}, ${trait}`).toBeGreaterThanOrEqual(
          -1e-12,
        );
      }
    }
  });

  it("keeps two Players' order when every weight is scaled by the same positive constant", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const random = mulberry32(seed);
      const { traits, weightings, a, b } = generated(random);
      const k = random() < 0.5 ? 0.01 + random() : 1 + random() * 100;
      const scaled = Object.fromEntries(
        FIT_TRAITS.map((t) => [t, weightings[t] * k]),
      ) as Weightings;
      const order = (w: Weightings) => {
        const sa = fitScore(traits, a, w).score;
        const sb = fitScore(traits, b, w).score;
        if (sa === null || sb === null) return `null:${sa === null}:${sb === null}`;
        const d = sa - sb;
        return Math.abs(d) < 1e-9 * (1 + k) ? "tie" : d > 0 ? "a" : "b";
      };
      expect(order(scaled), `seed ${seed}, k ${k}`).toBe(order(weightings));
    }
  });

  it("keeps every Fit Score within plus or minus the total weight, or null", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const random = mulberry32(seed);
      const { traits, weightings, a, b } = generated(random);
      for (const player of [a, b]) {
        const fit = fitScore(traits, player, weightings);
        if (fit.score === null) {
          expect(fit.knownWeight, `seed ${seed}`).toBe(0);
          continue;
        }
        expect(Math.abs(fit.score), `seed ${seed}`).toBeLessThanOrEqual(
          fit.totalWeight + 1e-12,
        );
        expect(fit.knownWeight, `seed ${seed}`).toBeLessThanOrEqual(fit.totalWeight + 1e-12);
      }
    }
  });

  it("keeps every default-weighted Fit Score between -1 and +1, or null", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { traits, a } = generated(mulberry32(seed));
      const { score } = fitScore(traits, a);
      if (score !== null) {
        expect(score, `seed ${seed}`).toBeGreaterThanOrEqual(-1);
        expect(score, `seed ${seed}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
