/**
 * The Fit Score's arithmetic lives here, apart from anything that fetches or renders, so it
 * can be tested without either. See CONTEXT.md for what a Course Trait, a Player Strength and
 * a Weighting are, and docs/adr/0001 for why every Strength is Derived rather than read.
 *
 * This file currently holds only the normalisation the scoring will be built on. The model
 * itself is a Ticket.
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
