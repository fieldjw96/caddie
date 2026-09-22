/**
 * THE FIT SCORE
 *
 * What it means. A Fit Score says how well one Player's game suits one Course, as we see it.
 * It is an opinion with its arithmetic on display. The facts going in are the Course's Traits
 * (how long it is, how hard it punishes a bad shot, how many par 5s it has) and the Player's
 * Strengths (how much of the field they beat, how steady their rounds are, how often they go
 * low). The opinions going in are ours and are all declared in this file: which Strength each
 * Trait calls for, and how much each Trait counts, its Weighting. A reader who disagrees with a
 * Weighting can change it and see the new answer. Nothing here is fitted to past results,
 * and docs/adr/0002 records why: the open data covers about six venue-seasons a year, too few
 * to tell what a course rewards from who happened to be playing it.
 *
 * What it does not mean. It is not a prediction of who will win, or of where anybody will
 * finish, and it is not a probability of anything. A Player with the highest Fit Score is the
 * one whose record best matches what this Course asks for, on our Weightings. Nothing more.
 *
 * Which Strength each Trait calls for. This is the part that makes it a fit rather than a
 * ranking of who is good, and it is declared, not fitted, exactly as the Weightings are:
 *
 * - Length, mean par 4 and longest par 4 call for Skill. A long Course hands every Player a
 *   longer club into every green, so a lapse costs more and class tells. Saying so plainly is
 *   the honest answer: length is not a matter of style.
 * - Slope against rating calls for Consistency. The gap between how a Course plays for a
 *   bogey golfer and for a scratch one measures how hard it punishes the wayward shot, which
 *   costs the Player whose rounds swing more than the one whose rounds hold.
 * - Par 5 share calls for Low rounds. More par 5s are more chances at birdie and eagle: a
 *   scoring week, won by whoever can go low when the Course lets them.
 *
 * Form is in no Trait. It says who is playing well lately, which is who is good, not whose
 * game suits this Course, and like a venue record the page shows it beside the Fit Score
 * rather than inside it. fit.test.ts asserts that not every Trait calls for the same Strength,
 * so this cannot quietly collapse back into one quantity reweighted.
 *
 * How it is worked out, in four steps.
 *
 * 1. Each Trait is placed on a scale from 0 to 1 within a fixed range stated below: a Course
 *    at the bottom of the range is 0, at the top 1. This is how much the Course asks for the
 *    Strength that Trait calls for. A very long Course asks a lot of all-round class; a short
 *    one asks little.
 *
 * 2. Each Strength is already a share, 0 to 1, where 0.5 is exactly the middle: of the field
 *    beaten, for Skill, or of the other Players with a value beaten, for Consistency and Low
 *    rounds. It is turned into an edge, from -1 to +1: (2 x Strength) - 1. A
 *    Player who beats three quarters of the field has an edge of +0.5; one who beats a
 *    quarter has an edge of -0.5.
 *
 * 3. Each Trait's contribution is its Weighting x how much the Course asks x the Player's
 *    edge. A strong Player gains most where the Course asks most; a weak one loses most there.
 *
 * 4. The Fit Score is the sum of the contributions. With the default Weightings, which add up
 *    to 1, it runs from -1 to +1. In general it lies between minus and plus the total of the
 *    Weightings: the arithmetic never rescales the reader's Weightings behind their back, so
 *    raising a Weighting always moves the score the way the reader would expect. Zero means
 *    the Course's demands leave this Player exactly level with the middle of the field.
 *
 * Why a fixed range, not the field of courses. Normalising against the Courses we happen to
 * hold would move every score whenever a Course is added or refused, and our set of Courses
 * is small and changes weekly. A fixed range, taken from what tour Courses play at, means a
 * Course's figure depends on that Course alone, and the page can print the range beside it.
 * A value beyond the range is clamped to its end, never extrapolated.
 *
 * Unknown is not zero. A Strength of zero would mean "finishes last every week"; a null
 * Strength means "we do not have the record to say". So a null Strength, or a Trait the Course
 * lacks (for instance because its hole-by-hole data failed the check in lib/course-traits.ts),
 * produces a null contribution, which adds nothing either way and is shown as unknown. The
 * result carries how much of the Weighting it rests on, so the page can say so. A Player with
 * no known contribution at all gets a null Fit Score, not a zero, and `rankFits` puts them in
 * a group of their own rather than at the bottom.
 *
 * A venue record is not in the score. It is a record at this Course, not a match between a
 * Trait and a kind of game, and it rests on a handful of results where it exists at all. The
 * page shows it beside the Fit Score rather than inside it.
 *
 * This module is pure: it imports nothing, reads no database and makes no network call. It is
 * handed its inputs, and fit.test.ts checks its import graph stays that way.
 */

/**
 * Where a value sits within a range, as 0 to 1. A range of zero width is 0.5: with every
 * player identical on a trait, that trait cannot separate them, and saying so beats dividing
 * by zero.
 */
export function normalise(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new RangeError("normalise requires finite numbers");
  }
  if (max < min) throw new RangeError("normalise requires max >= min");
  if (max === min) return 0.5;
  const clamped = Math.min(Math.max(value, min), max);
  return (clamped - min) / (max - min);
}

/**
 * The Strengths a Trait can call for: see lib/strengths/derive.ts for Skill and
 * lib/strengths/rounds.ts for Consistency and Low rounds.
 */
export type FitStrengthName = "skill" | "consistency" | "low_rounds";

/** The Course Traits the Fit Score weighs, as named in lib/course-traits.ts. */
export type FitTraitName =
  | "length_yards"
  | "slope_rating_gap"
  | "mean_par_4_yards"
  | "longest_par_4_yards"
  | "par_5_share";

export interface TraitScale {
  /** The value at which the Course asks nothing of this Trait's Strength. */
  min: number;
  /** The value at which it asks the most. */
  max: number;
  /** The Strength a Course high on this Trait calls for. */
  calls: FitStrengthName;
  /** Why it calls for that Strength, in a sentence the page prints beside the Weighting. */
  why: string;
}

/**
 * Each Trait's fixed range, the Strength it calls for and why. The ranges span what PGA Tour
 * Courses play at from their championship tees, so almost every Course lands inside them.
 */
export const TRAIT_SCALES: Readonly<Record<FitTraitName, TraitScale>> = {
  // From a short tour course, about 6,900 yards, to the longest, about 7,800.
  length_yards: {
    min: 6_900,
    max: 7_800,
    calls: "skill",
    why: "Every approach is a longer club, so a lapse costs more and class tells.",
  },
  // Slope minus Course Rating, 60 to 80 points across tour tees.
  slope_rating_gap: {
    min: 60,
    max: 80,
    calls: "consistency",
    why: "The bigger the gap, the harder the Course punishes a wayward shot, which costs the Player whose rounds swing more than the one whose rounds hold.",
  },
  // The average par 4, 400 to 480 yards. Like total length, but measured on the holes where
  // most of a round's approach shots are played, so par 5s do not inflate it.
  mean_par_4_yards: {
    min: 400,
    max: 480,
    calls: "skill",
    why: "Long par 4s test the approach game on most of the holes in a round, and that is class, not style.",
  },
  // The longest par 4, 460 to 540 yards.
  longest_par_4_yards: {
    min: 460,
    max: 540,
    calls: "skill",
    why: "Whether one hole asks for a long iron into a green: the same test as length, on one hole.",
  },
  // Par 5s as a share of eighteen holes, from 2 of 18 to 5 of 18.
  par_5_share: {
    min: 2 / 18,
    max: 5 / 18,
    calls: "low_rounds",
    why: "More par 5s mean more chances at birdie and eagle: a scoring week, which suits the Player who can go low when the Course lets them.",
  },
};

/** How much each Trait counts. Any non-negative numbers: they need not add up to 1. */
export type Weightings = Readonly<Record<FitTraitName, number>>;

/**
 * Our declared Weightings, shown on the page and where its sliders start. They add up to 1,
 * so the default Fit Score runs from -1 to +1.
 */
export const DEFAULT_WEIGHTINGS: Weightings = {
  // The heaviest, because it is the one Trait every Course has, read off its own published
  // card, and the plainest statement of how demanding a Course is.
  length_yards: 0.3,
  // Nearly as heavy: the only published measure of how hard a Course plays beyond its length,
  // and the Trait that calls for Consistency.
  slope_rating_gap: 0.25,
  // Where par 4s are long, the approach game is tested all round. Lighter than total length
  // because it overlaps with it, and because it is refused when hole data is untrusted.
  mean_par_4_yards: 0.15,
  // One hole's worth of the same idea, so the lightest.
  longest_par_4_yards: 0.1,
  // The one Trait that calls for Low rounds: enough to separate a Player who goes low at a
  // birdie-fest, not so much that a scoring week outweighs everything else about the Course.
  par_5_share: 0.2,
};

/** A Course's Traits by name. A Trait that is absent or null is unknown for this Course. */
export type FitCourseTraits = Readonly<Partial<Record<FitTraitName, number | null>>>;

/** A Player's Strengths by name, each 0 to 1 or null when there is too little record to say. */
export type FitPlayerStrengths = Readonly<Partial<Record<FitStrengthName, number | null>>>;

/** One Trait's line in the working, enough to explain it without recomputing anything. */
export interface FitComponent {
  trait: FitTraitName;
  /** The Course's own value, or null if the Course lacks this Trait. */
  traitValue: number | null;
  /** The fixed range the value was placed in. */
  range: { min: number; max: number };
  /** How much the Course asks for the Strength, 0 to 1; null if the Trait is unknown. */
  normalised: number | null;
  weight: number;
  /** The Strength this Trait calls for. */
  strength: FitStrengthName;
  /** The Player's value of that Strength, 0 to 1, or null if unknown. */
  strengthValue: number | null;
  /** (2 x strengthValue) - 1, from -1 to +1, or null if the Strength is unknown. */
  edge: number | null;
  /** weight x normalised x edge, or null if either is unknown. Never a stand-in zero. */
  contribution: number | null;
}

export interface FitScore {
  /** The sum of the known contributions, or null when none is known. */
  score: number | null;
  /** Every Trait's working, in the order of TRAIT_SCALES. */
  components: FitComponent[];
  /** The total of the Weightings: the score lies between minus and plus this. */
  totalWeight: number;
  /** The Weighting resting on known contributions, out of totalWeight. */
  knownWeight: number;
}

export const FIT_TRAITS = Object.keys(TRAIT_SCALES) as FitTraitName[];

function checkWeightings(weightings: Weightings): void {
  for (const trait of FIT_TRAITS) {
    const weight = weightings[trait];
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(
        `Weighting for ${trait} must be a finite number >= 0, got ${weight}`,
      );
    }
  }
}

function checkStrength(name: FitStrengthName, value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Strength ${name} must be between 0 and 1 or null, got ${value}`);
  }
  return value;
}

/**
 * One Player's Fit Score at one Course, with every Trait's working broken out. Weightings are
 * an argument so the page can pass whatever the reader has set the sliders to.
 */
export function fitScore(
  traits: FitCourseTraits,
  strengths: FitPlayerStrengths,
  weightings: Weightings = DEFAULT_WEIGHTINGS,
): FitScore {
  checkWeightings(weightings);

  let score: number | null = null;
  let totalWeight = 0;
  let knownWeight = 0;

  const components = FIT_TRAITS.map((trait): FitComponent => {
    const { min, max, calls } = TRAIT_SCALES[trait];
    const weight = weightings[trait];
    const traitValue = traits[trait] ?? null;
    const normalised = traitValue === null ? null : normalise(traitValue, min, max);
    const strengthValue = checkStrength(calls, strengths[calls] ?? null);
    const edge = strengthValue === null ? null : 2 * strengthValue - 1;
    const contribution =
      normalised === null || edge === null ? null : weight * normalised * edge;

    totalWeight += weight;
    if (contribution !== null) {
      score = (score ?? 0) + contribution;
      knownWeight += weight;
    }
    return {
      trait,
      traitValue,
      range: { min, max },
      normalised,
      weight,
      strength: calls,
      strengthValue,
      edge,
      contribution,
    };
  });

  return { score, components, totalWeight, knownWeight };
}

export interface RankedFits<P> {
  /** Players with a Fit Score, highest first. Ties keep the order they were given in. */
  scored: { player: P; fit: FitScore & { score: number } }[];
  /** Players with no Fit Score: not ranked, because unknown is not last. */
  unscored: { player: P; fit: FitScore }[];
}

/** Splits Players into those with a Fit Score, ranked, and those without one. */
export function rankFits<P>(entries: readonly { player: P; fit: FitScore }[]): RankedFits<P> {
  const scored: RankedFits<P>["scored"] = [];
  const unscored: RankedFits<P>["unscored"] = [];
  for (const { player, fit } of entries) {
    const { score } = fit;
    if (score === null) unscored.push({ player, fit });
    else scored.push({ player, fit: { ...fit, score } });
  }
  scored.sort((a, b) => b.fit.score - a.fit.score);
  return { scored, unscored };
}
