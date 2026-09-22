import { describe, expect, it } from "vitest";
import { normalise } from "./fit";

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
