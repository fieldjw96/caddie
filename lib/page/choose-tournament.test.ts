import { describe, expect, it } from "vitest";
import { checkRankable } from "../ingest/rankable";
import { chooseRankableTournament, type TournamentCandidate } from "./choose-tournament";

const courses = [
  { id: 1, name: "Port Royal Golf Course" },
  { id: 2, name: "Seaside At Sea Island Golf Club" },
  { id: 3, name: "El Cardonal at Diamante" },
];

/** Every Course above has a Trait but Port Royal and El Cardonal, whose Traits are missing. */
const traitCounts = new Map([[2, 9]]);

const candidate = (
  name: string,
  courseName: string | null,
  courseId: number | null = null,
): TournamentCandidate & { endDate: string } => ({
  name,
  courseName,
  courseId,
  sourceUrl: `https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1#${name}`,
  endDate: "2026-11-22",
});

const AUSTIN = candidate("Austin Championship", null);
const BUTTERFIELD = candidate("Butterfield Bermuda Championship", "Port Royal Golf Course");
const RSM = candidate("RSM Classic", "Seaside At Sea Island Golf Club");

describe("chooseRankableTournament", () => {
  it("takes the soonest Tournament when it is rankable", () => {
    const chosen = chooseRankableTournament([RSM, BUTTERFIELD], courses, traitCounts, true);
    expect(chosen.tournament?.name).toBe("RSM Classic");
    expect(chosen.skipped).toEqual([]);
    expect(chosen.examined).toBe(1);
  });

  it("skips a candidate `checkRankable` refuses, and says so with that reason", () => {
    // The input the loader builds for Butterfield, refused because Port Royal has no Trait.
    const refusal = checkRankable({
      next: { name: BUTTERFIELD.name, courseName: BUTTERFIELD.courseName, courseId: 1 },
      courseTraitCount: 0,
      anyPlayerHasStrength: true,
    });
    if (refusal.ok) expect.fail("the fixture must be one `checkRankable` refuses");

    const chosen = chooseRankableTournament([BUTTERFIELD, RSM], courses, traitCounts, true);
    expect(chosen.tournament?.name).toBe("RSM Classic");
    expect(chosen.skipped).toEqual([
      {
        name: "Butterfield Bermuda Championship",
        reason: refusal.reason,
        sourceUrl: BUTTERFIELD.sourceUrl,
      },
    ]);
    expect(chosen.examined).toBe(2);
  });

  it("names every Tournament it skipped, in schedule order, each with its own reason", () => {
    const chosen = chooseRankableTournament(
      [AUSTIN, BUTTERFIELD, RSM],
      courses,
      traitCounts,
      true,
    );
    expect(chosen.tournament?.name).toBe("RSM Classic");
    expect(chosen.skipped.map((s) => s.name)).toEqual([
      "Austin Championship",
      "Butterfield Bermuda Championship",
    ]);
    // Different conditions, so different reasons: no venue at all, then a Course with no Trait.
    expect(chosen.skipped[0]?.reason).toContain("recorded no Course name for it at all");
    expect(chosen.skipped[1]?.reason).toContain("no Course Trait");
    expect(chosen.skipped.map((s) => s.sourceUrl)).toEqual([
      AUSTIN.sourceUrl,
      BUTTERFIELD.sourceUrl,
    ]);
  });

  it("matches a Course by `courseId` where the schedule stored one", () => {
    const stored = candidate("RSM Classic", "Seaside, as the schedule writes it", 2);
    const chosen = chooseRankableTournament([stored], courses, traitCounts, true);
    expect(chosen.tournament?.name).toBe("RSM Classic");
    expect(chosen.skipped).toEqual([]);
  });

  it("returns the true next Tournament, and skips nothing, when none is rankable", () => {
    const chosen = chooseRankableTournament([AUSTIN, BUTTERFIELD], courses, traitCounts, true);
    expect(chosen.tournament?.name).toBe("Austin Championship");
    expect(chosen.skipped).toEqual([]);
    expect(chosen.examined).toBe(2);
  });

  it("returns the true next Tournament without walking when no Player has a Strength", () => {
    const chosen = chooseRankableTournament([RSM, BUTTERFIELD], courses, traitCounts, false);
    expect(chosen.tournament?.name).toBe("RSM Classic");
    expect(chosen.skipped).toEqual([]);
    expect(chosen.examined).toBe(1);
  });

  it("treats a Course absent from the Trait counts as having none", () => {
    const chosen = chooseRankableTournament([RSM, BUTTERFIELD], courses, new Map(), true);
    // Nothing is rankable once even Seaside's Traits are missing, so the true next stands.
    expect(chosen.tournament?.name).toBe("RSM Classic");
    expect(chosen.skipped).toEqual([]);
    expect(chosen.examined).toBe(2);
  });

  it("answers null for an empty schedule", () => {
    const chosen = chooseRankableTournament([], courses, traitCounts, true);
    expect(chosen.tournament).toBeNull();
    expect(chosen.skipped).toEqual([]);
    expect(chosen.examined).toBe(0);
  });
});
