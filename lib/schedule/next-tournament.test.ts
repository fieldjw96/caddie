import { describe, expect, it } from "vitest";
import { nextTournament, type UpcomingTournament } from "./next-tournament";

const schedule: UpcomingTournament[] = [
  { name: "The American Express", startDate: "2026-01-25" },
  { name: "Farmers Insurance Open", startDate: "2026-02-01" },
  { name: "WM Phoenix Open", startDate: "2026-02-08" },
  { name: "RSM Classic", startDate: "2026-11-22" },
];

describe("nextTournament", () => {
  it("returns the soonest Tournament during a normal week", () => {
    const now = new Date("2026-01-20T12:00:00Z");
    expect(nextTournament(schedule, now)?.name).toBe("The American Express");
  });

  it("returns the Tournament that starts today, not the one after it", () => {
    const now = new Date("2026-02-01T18:00:00Z");
    expect(nextTournament(schedule, now)?.name).toBe("Farmers Insurance Open");
  });

  it("returns null once the season's last Tournament has been played", () => {
    const now = new Date("2026-11-23T00:00:00Z");
    expect(nextTournament(schedule, now)).toBeNull();
  });

  it("breaks a same-day tie deterministically, by name", () => {
    const tied: UpcomingTournament[] = [
      { name: "WM Phoenix Open", startDate: "2026-02-08" },
      { name: "Additional Event", startDate: "2026-02-08" },
    ];
    expect(nextTournament(tied, new Date("2026-02-01T00:00:00Z"))?.name).toBe(
      "Additional Event",
    );
    // Order in the input must not change the answer.
    expect(nextTournament([...tied].reverse(), new Date("2026-02-01T00:00:00Z"))?.name).toBe(
      "Additional Event",
    );
  });

  it("returns null for an empty schedule", () => {
    expect(nextTournament([], new Date("2026-06-01T00:00:00Z"))).toBeNull();
  });
});
