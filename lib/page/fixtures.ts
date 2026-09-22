// Stored rows for the page's tests: one Course whose holes are trusted, and Augusta, whose
// OpenGolfAPI holes are the member tees, 1,080 yards short of its card.

import type { CourseView, PlayerView, StoredTraits } from "./data";

export const TRUSTED_COURSE: CourseView = {
  name: "Bay Hill Club and Lodge",
  architect: "Dick Wilson",
  sourceUrl: "https://api.opengolfapi.org/v1/courses/1",
  attribution: "Course data from OpenGolfAPI, ODbL 1.0",
  holesTrusted: true,
  holesCheckedTee: "championship",
  holesYardageSum: 7466,
  holesYardageDifference: 0,
  publishedYardage: 7466,
  championshipTee: { name: "championship", slope: 150, rating: 77.1 },
  altitude: 105,
  greenSurface: "Bermuda",
  courseFactsSourceUrl: "https://en.wikipedia.org/w/index.php?title=Bay_Hill&oldid=1",
};

export const TRUSTED_TRAITS: StoredTraits = {
  length_yards: { value: 7466, unit: "yards" },
  par: { value: 72, unit: "strokes" },
  par_3_count: { value: 4, unit: "holes" },
  par_4_count: { value: 10, unit: "holes" },
  par_5_count: { value: 4, unit: "holes" },
  par_5_share: { value: 4 / 18, unit: "share" },
  mean_par_4_yards: { value: 452.4, unit: "yards" },
  longest_par_4_yards: { value: 510, unit: "yards" },
  slope_rating_gap: { value: 72.9, unit: "points" },
  altitude_adjusted_length_yards: { value: 7450, unit: "yards" },
};

export const UNTRUSTED_COURSE: CourseView = {
  ...TRUSTED_COURSE,
  name: "Augusta National Golf Club",
  holesTrusted: false,
  holesCheckedTee: "member",
  holesYardageSum: 6475,
  holesYardageDifference: -1080,
  publishedYardage: 7555,
};

export const UNTRUSTED_TRAITS: StoredTraits = {
  length_yards: { value: 7555, unit: "yards" },
  par: { value: 72, unit: "strokes" },
  slope_rating_gap: { value: 60.8, unit: "points" },
};

const strength = (value: number | null, sampleSize: number) => ({ value, sampleSize });

/**
 * Three Players with a Fit Score and one without. Ahead on Skill, Clark leads on the declared
 * Weightings, which lean on the Traits that call for Skill; Baker, ahead on Form, leads once
 * only the par 5 share counts. Adams has Skill but no Form, so one of Adams's contributions
 * is "no record". Dunn has too few results for anything.
 */
export const PLAYERS: PlayerView[] = [
  {
    id: 1,
    name: "Alex Adams",
    country: "England",
    skill: strength(0.6, 8),
    form: strength(null, 3),
    venueRecord: null,
  },
  {
    id: 2,
    name: "Blair Baker",
    country: "United States",
    skill: strength(0.55, 9),
    form: strength(0.95, 6),
    venueRecord: strength(null, 1),
  },
  {
    id: 3,
    name: "Casey Clark",
    country: null,
    skill: strength(0.9, 12),
    form: strength(0.5, 5),
    venueRecord: strength(0.8, 5),
  },
  {
    id: 4,
    name: "Drew Dunn",
    country: "Australia",
    skill: strength(null, 2),
    form: strength(null, 0),
    venueRecord: null,
  },
];
