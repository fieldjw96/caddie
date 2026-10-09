import { describe, expect, it } from "vitest";
import { checkRankable, type RankableInput } from "./rankable";

const matched: RankableInput["next"] = {
  name: "The Players Championship",
  courseName: "TPC Sawgrass",
  courseId: 7,
};

describe("checkRankable", () => {
  it("passes when no next Tournament is scheduled", () => {
    expect(
      checkRankable({ next: null, courseTraitCount: 0, anyPlayerHasStrength: false }),
    ).toEqual({ ok: true });
  });

  it("passes when the next Tournament's Course has a Trait and the roster has a Strength", () => {
    expect(
      checkRankable({ next: matched, courseTraitCount: 1, anyPlayerHasStrength: true }),
    ).toEqual({ ok: true });
  });

  it("fails, naming the Tournament and the schedule's own Course name, when no `courses` row is matched", () => {
    const result = checkRankable({
      next: {
        name: "Baycurrent Classic",
        courseName: "Accordia Golf Narashino C.C.",
        courseId: null,
      },
      courseTraitCount: 0,
      anyPlayerHasStrength: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toContain("Baycurrent Classic");
    expect(result.reason).toContain("Accordia Golf Narashino C.C.");
    expect(result.reason).toContain("zero Player rows");
  });

  it("still names the Tournament when the schedule recorded no Course name at all", () => {
    const result = checkRankable({
      next: { name: "Open de Something", courseName: null, courseId: null },
      courseTraitCount: 0,
      anyPlayerHasStrength: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toContain("Open de Something");
    expect(result.reason).not.toContain("null");
  });

  it("fails when the matched Course has no Course Trait", () => {
    const result = checkRankable({
      next: matched,
      courseTraitCount: 0,
      anyPlayerHasStrength: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toContain("The Players Championship");
    expect(result.reason).toContain("no Course Trait");
  });

  it("fails when no Player has any Strength", () => {
    const result = checkRankable({
      next: matched,
      courseTraitCount: 3,
      anyPlayerHasStrength: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toContain("No Player has any Strength");
  });
});
