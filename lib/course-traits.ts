// Course Traits: the small set of facts about a Course the Fit Score will eventually weigh.
// Every Trait here is a fact, never a judgement about who a course suits — see CONTEXT.md's
// "Course Trait" and docs/adr/0002. This module is pure: no database client, no network call,
// only arithmetic over the course facts it is given, so every Trait is testable against a
// fixture. Writing the result to `course_traits` is lib/course-traits-store.ts's job, not
// this one's.
//
// What is measured, and why:
//
// - `length_yards`, the published championship total. The number a reader already has in
//   mind, and the one everything else here is measured against.
// - `par`, the card's total par.
// - `par_3_count`, `par_4_count`, `par_5_count`, the par mix. How a course spreads its pars
//   changes what a round rewards: a course built on short par 4s plays differently from one
//   built around three-shot holes, even at the same total par.
// - `longest_par_4_yards`, which separates a course where a long hitter reaches the green with
//   a short iron from one where everybody plays a mid iron in.
// - `mean_par_4_yards`, the same idea spread across every par 4 rather than resting on one.
// - `par_5_share`, the fraction of holes that are par 5s. A scoring opportunity favours a
//   different game than attrition does, and this is the plainest measure of how much of a
//   round is spent trying to make birdies rather than trying to survive.
// - `slope_rating_gap`, the published Slope Rating minus the published Course Rating, read off
//   the tee whose card matches the published total. Rating is a scratch golfer's expected
//   score; Slope is how much harder the same course plays for a weaker one. The gap between
//   the two published numbers is the closest thing open data offers to "this course punishes a
//   wayward shot", without this repo inventing a formula of its own to get there.
//
// Altitude is not measured here. Wikipedia carries it, per docs/adr/0002's list, but no ingest
// Ticket has stored it on a Course yet, and adding a new fetch is out of scope for a module
// that only derives from facts already stored. It can be added once that fact exists.
//
// `length_yards`, `par` and `slope_rating_gap` are course-level: OpenGolfAPI's own published
// total, par and per-tee card, trusted whatever the hole-by-hole data says. The par mix, both
// par-4 lengths and the par-5 share all read the `holes` array, and `holes_trusted` is the
// gate on every one of them: OpenGolfAPI returns Augusta's member-tee holes, 1,080 yards short
// of its card, and nothing here can tell a correct hole from a wrong one by inspection alone.
// So any Trait built from `holes` is refused outright — absent from the result, not a zero and
// not the course-level number standing in for it — for a course whose `holes_trusted` is not
// exactly `true`. See db/schema.ts and lib/opengolfapi/holes.ts for the check itself.

import type { CourseHole, CourseTee, courses } from "../db/schema";

/** The columns of a stored course a Trait can be built from. */
export type CourseFacts = Pick<
  typeof courses.$inferSelect,
  "par" | "publishedYardage" | "tees" | "holes" | "holesCheckedTee" | "holesTrusted"
>;

/** One derived Trait, ready for `course_traits` once a `courseId` is attached to it. */
export type DerivedCourseTrait = {
  trait: string;
  value: number;
  unit: string;
  source: "derived";
  sourceUrl: null;
  derivation: string;
};

function courseLevel(fields: string): string {
  return `Derived from ${fields} (course-level data, trusted whatever holes_trusted is).`;
}

function trustedHoles(fields: string): string {
  return `Derived from ${fields} (trusted hole data; refused when holes_trusted is not true).`;
}

function makeTrait(
  trait: string,
  value: number,
  unit: string,
  derivation: string,
): DerivedCourseTrait {
  return { trait, value, unit, source: "derived", sourceUrl: null, derivation };
}

/**
 * The tee whose own card matches the published total: the same "championship tee" idea
 * lib/opengolfapi/holes.ts uses to pick which tee's hole yardages to check, but here read
 * straight off `tees`, which is course-level data and needs no hole yardages at all.
 */
function championshipTee(
  tees: CourseTee[] | null,
  publishedYardage: number | null,
): CourseTee | null {
  if (!tees || publishedYardage === null) return null;
  return tees.find((t) => t.yardage === publishedYardage) ?? null;
}

/** Traits available whatever `holes_trusted` says: OpenGolfAPI's own course- and tee-level facts. */
function courseLevelTraits(course: CourseFacts): DerivedCourseTrait[] {
  const traits: DerivedCourseTrait[] = [];

  if (course.publishedYardage !== null) {
    traits.push(
      makeTrait(
        "length_yards",
        course.publishedYardage,
        "yards",
        courseLevel("courses.published_yardage"),
      ),
    );
  }

  if (course.par !== null) {
    traits.push(makeTrait("par", course.par, "strokes", courseLevel("courses.par")));
  }

  const tee = championshipTee(course.tees, course.publishedYardage);
  if (tee && tee.slope !== null && tee.rating !== null) {
    traits.push(
      makeTrait(
        "slope_rating_gap",
        tee.slope - tee.rating,
        "points",
        courseLevel(
          `courses.tees[name=${tee.name}].slope, courses.tees[name=${tee.name}].rating`,
        ),
      ),
    );
  }

  return traits;
}

/** The yardage of a hole at `tee`, or `null` if that hole carries none. */
function yardageAt(hole: CourseHole, tee: string): number | null {
  const yardage = hole.yardages[tee];
  return yardage === undefined ? null : yardage;
}

/** Traits read off the `holes` array: refused outright unless `holes_trusted` is `true`. */
function holeDerivedTraits(course: CourseFacts): DerivedCourseTrait[] {
  if (course.holesTrusted !== true || !course.holes || course.holes.length === 0) return [];
  const holes = course.holes;
  const holeCount = holes.length;

  const traits: DerivedCourseTrait[] = [];
  const byPar = (par: number) => holes.filter((h) => h.par === par);
  const parFours = byPar(4);
  const parFives = byPar(5);

  traits.push(
    makeTrait("par_3_count", byPar(3).length, "holes", trustedHoles("courses.holes[].par")),
  );
  traits.push(
    makeTrait("par_4_count", parFours.length, "holes", trustedHoles("courses.holes[].par")),
  );
  traits.push(
    makeTrait("par_5_count", parFives.length, "holes", trustedHoles("courses.holes[].par")),
  );
  traits.push(
    makeTrait(
      "par_5_share",
      parFives.length / holeCount,
      "share",
      trustedHoles("courses.holes[].par"),
    ),
  );

  const tee = course.holesCheckedTee;
  if (tee !== null && parFours.length > 0) {
    const yardages = parFours
      .map((h) => yardageAt(h, tee))
      .filter((y): y is number => y !== null);
    // Only when every par 4 carries a yardage at the checked tee: a length Trait built on a
    // partial set would be quietly wrong in the same way an unchecked one would be.
    if (yardages.length === parFours.length) {
      const derivation = trustedHoles(
        `courses.holes[].yardages[${tee}] where courses.holes[].par = 4`,
      );
      traits.push(
        makeTrait("longest_par_4_yards", Math.max(...yardages), "yards", derivation),
      );
      traits.push(
        makeTrait(
          "mean_par_4_yards",
          yardages.reduce((total, y) => total + y, 0) / yardages.length,
          "yards",
          derivation,
        ),
      );
    }
  }

  return traits;
}

/** Derives every Course Trait this repo can currently measure from a stored course's facts. */
export function deriveCourseTraits(course: CourseFacts): DerivedCourseTrait[] {
  return [...courseLevelTraits(course), ...holeDerivedTraits(course)];
}
