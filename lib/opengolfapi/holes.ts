// Whether a course's hole-by-hole yardages can be believed. This is the substance of ingesting
// OpenGolfAPI: its hole yardages are wrong at some PGA venues. Augusta returns member-tee
// holes summing 6,365 yards against a published 7,445. The check does not correct them, since
// we have nothing to correct them with. It records whether they agree with the course's own
// total, so that anything deriving a Trait from them can refuse to.

import {
  HOLE_YARDAGE_TOLERANCE_PERCENT,
  type CourseHole,
  type CourseTee,
} from "../../db/schema";

export type HoleCheck = {
  /** The hole yardage key that was summed. */
  tee: string;
  sum: number;
  published: number;
  /** `sum - published`. Negative when the holes come up short. */
  difference: number;
  trusted: boolean;
};

const key = (name: string) => name.trim().toLowerCase();

/** The sum of one tee's yardages over every hole. A hole missing that tee counts as 0. */
function sumFor(holes: CourseHole[], tee: string): number {
  return holes.reduce((total, hole) => total + (hole.yardages[tee] ?? 0), 0);
}

/**
 * Which tee's hole yardages to hold against the published total. That is the tee whose own
 * card matches the published total, when the holes carry yardages for it. Otherwise, as at
 * Augusta, where the published total is the Black tee's and the holes carry only `member`, it
 * is the longest set the holes do carry: the most generous comparison available, so that a
 * course is only distrusted when no tee's holes could account for its total.
 */
function teeToCheck(holes: CourseHole[], tees: CourseTee[], published: number): string | null {
  const keys = [...new Set(holes.flatMap((hole) => Object.keys(hole.yardages)))];
  if (keys.length === 0) return null;

  const championship = tees.find((tee) => tee.yardage === published);
  if (championship) {
    const named = keys.find((k) => key(k) === key(championship.name));
    if (named !== undefined) return named;
  }

  let longest: string | null = null;
  for (const k of keys) {
    if (longest === null || sumFor(holes, k) > sumFor(holes, longest)) longest = k;
  }
  return longest;
}

/**
 * Holds the holes against the published total. `null` when there is nothing to check, no
 * holes or no published total, and a Trait derived from hole yardages must be refused then
 * too: only `trusted: true` licenses one.
 */
export function checkHoles(
  holes: CourseHole[] | null,
  tees: CourseTee[] | null,
  published: number | null,
): HoleCheck | null {
  if (!holes || holes.length === 0 || published === null || published <= 0) return null;

  const tee = teeToCheck(holes, tees ?? [], published);
  if (tee === null) return null;

  const sum = sumFor(holes, tee);
  const difference = sum - published;
  // Integer arithmetic, the same comparison courses_holes_trusted_is_the_check makes.
  const trusted = Math.abs(difference) * 100 <= HOLE_YARDAGE_TOLERANCE_PERCENT * published;
  return { tee, sum, published, difference, trusted };
}
