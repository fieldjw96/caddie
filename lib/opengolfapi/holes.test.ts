// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { CourseHole, CourseTee } from "../../db/schema";
import augusta from "./fixtures/augusta-national.detail.json";
import { checkHoles } from "./holes";
import { toCourseRow } from "./ingest";
import { courseResponse, parse } from "./schema";

const tee = (name: string, yardage: number): CourseTee => ({
  name,
  yardage,
  gender: "Male",
  par: 72,
  rating: 72,
  slope: 130,
});

/** Eighteen holes whose `tees` yardages sum to each given total. */
function holesSumming(totals: Record<string, number>): CourseHole[] {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    yardages: Object.fromEntries(
      Object.entries(totals).map(([k, total]) => [
        k,
        i === 0 ? total - 17 * Math.floor(total / 18) : Math.floor(total / 18),
      ]),
    ),
  }));
}

describe("checkHoles", () => {
  it("flags Augusta, whose holes sum 1,080 yards short of its published total", () => {
    // OpenGolfAPI's real response for Augusta National, captured 2026-09-21: the card is the
    // Black tee's 7,445, and the holes carry only the member tees'.
    const course = parse(courseResponse, augusta, "fixture");
    const row = toCourseRow(course, "attribution");

    expect(row.publishedYardage).toBe(7445);
    expect(row.holesCheckedTee).toBe("member");
    expect(row.holesYardageSum).toBe(6365);
    expect(row.holesYardageDifference).toBe(-1080);
    expect(row.holesTrusted).toBe(false);
  });

  it("trusts holes that sum exactly to the published total", () => {
    const check = checkHoles(holesSumming({ black: 7200 }), [tee("Black", 7200)], 7200);
    expect(check).toEqual({
      tee: "black",
      sum: 7200,
      published: 7200,
      difference: 0,
      trusted: true,
    });
  });

  it("trusts a difference of exactly 3%, and not one yard more", () => {
    expect(checkHoles(holesSumming({ a: 10300 }), [], 10000)?.trusted).toBe(true);
    expect(checkHoles(holesSumming({ a: 9700 }), [], 10000)?.trusted).toBe(true);
    expect(checkHoles(holesSumming({ a: 10301 }), [], 10000)?.trusted).toBe(false);
    expect(checkHoles(holesSumming({ a: 9699 }), [], 10000)?.trusted).toBe(false);
  });

  it("checks the tee whose card is the published total, not merely the longest", () => {
    // Muirfield-shaped: the championship tee is present, and a longer set is too.
    const holes = holesSumming({ Memorial: 7392, extra: 7900 });
    const check = checkHoles(holes, [tee("memorial", 7392)], 7392);
    expect(check).toMatchObject({ tee: "Memorial", difference: 0, trusted: true });
  });

  it("falls back to the longest set when the championship tee has no holes", () => {
    const holes = holesSumming({ member: 6365, forward: 5200 });
    const check = checkHoles(holes, [tee("Black", 7445), tee("Member", 6365)], 7445);
    expect(check).toMatchObject({ tee: "member", difference: -1080, trusted: false });
  });

  it("does not trust a set with a hole missing", () => {
    const holes = holesSumming({ black: 7200 });
    holes[17]!.yardages = {};
    expect(checkHoles(holes, [tee("Black", 7200)], 7200)?.trusted).toBe(false);
  });

  it("gives no verdict when there is nothing to check", () => {
    expect(checkHoles(null, [], 7200)).toBeNull();
    expect(checkHoles([], [], 7200)).toBeNull();
    expect(checkHoles(holesSumming({ a: 7200 }), [], null)).toBeNull();
    expect(checkHoles([{ number: 1, par: 4, yardages: {} }], [], 7200)).toBeNull();
  });
});
