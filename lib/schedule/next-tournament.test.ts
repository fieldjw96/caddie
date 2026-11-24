import { describe, expect, it } from "vitest";
import {
  nextTournament,
  upcomingTournaments,
  type UpcomingTournament,
} from "./next-tournament";

const schedule: UpcomingTournament[] = [
  { name: "The American Express", startDate: "2026-01-22", endDate: "2026-01-25" },
  { name: "Farmers Insurance Open", startDate: "2026-01-29", endDate: "2026-02-01" },
  { name: "WM Phoenix Open", startDate: "2026-02-05", endDate: "2026-02-08" },
  { name: "RSM Classic", startDate: "2026-11-19", endDate: "2026-11-22" },
];

describe("nextTournament", () => {
  it("returns the soonest Tournament the day before it starts", () => {
    const now = new Date("2026-01-21T12:00:00Z");
    expect(nextTournament(schedule, now)?.name).toBe("The American Express");
  });

  it("stays the current Tournament on the day it starts", () => {
    const now = new Date("2026-01-22T18:00:00Z");
    expect(nextTournament(schedule, now)?.name).toBe("The American Express");
  });

  it("stays the current Tournament on its final day", () => {
    const now = new Date("2026-01-25T23:00:00Z");
    expect(nextTournament(schedule, now)?.name).toBe("The American Express");
  });

  it("moves on to the next Tournament the day after the current one's final day", () => {
    const now = new Date("2026-01-26T00:00:00Z");
    expect(nextTournament(schedule, now)?.name).toBe("Farmers Insurance Open");
  });

  it("returns null once the season's last Tournament has been played", () => {
    const now = new Date("2026-11-23T00:00:00Z");
    expect(nextTournament(schedule, now)).toBeNull();
  });

  it("breaks a same-day tie deterministically, by name", () => {
    const tied: UpcomingTournament[] = [
      { name: "WM Phoenix Open", startDate: "2026-02-05", endDate: "2026-02-08" },
      { name: "Additional Event", startDate: "2026-02-05", endDate: "2026-02-08" },
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

describe("upcomingTournaments", () => {
  it("returns every Tournament still to be played, soonest end date first", () => {
    const shuffled = [schedule[3]!, schedule[1]!, schedule[0]!, schedule[2]!];
    expect(
      upcomingTournaments(shuffled, new Date("2026-01-21T12:00:00Z")).map((t) => t.name),
    ).toEqual([
      "The American Express",
      "Farmers Insurance Open",
      "WM Phoenix Open",
      "RSM Classic",
    ]);
  });

  it("drops the Tournaments already played, keeping one on its final day", () => {
    expect(
      upcomingTournaments(schedule, new Date("2026-02-01T18:00:00Z")).map((t) => t.name),
    ).toEqual(["Farmers Insurance Open", "WM Phoenix Open", "RSM Classic"]);
  });

  it("breaks a same-day tie by name, whatever order the rows arrived in", () => {
    const tied: UpcomingTournament[] = [
      { name: "WM Phoenix Open", startDate: "2026-02-05", endDate: "2026-02-08" },
      { name: "Additional Event", startDate: "2026-02-05", endDate: "2026-02-08" },
    ];
    const names = (rows: UpcomingTournament[]) =>
      upcomingTournaments(rows, new Date("2026-02-01T00:00:00Z")).map((t) => t.name);
    expect(names(tied)).toEqual(["Additional Event", "WM Phoenix Open"]);
    expect(names([...tied].reverse())).toEqual(["Additional Event", "WM Phoenix Open"]);
  });

  it("leaves the schedule it was given untouched", () => {
    const rows = [...schedule];
    upcomingTournaments(rows, new Date("2026-01-01T00:00:00Z"));
    expect(rows).toEqual(schedule);
  });

  it("is empty once the season's last Tournament has been played", () => {
    expect(upcomingTournaments(schedule, new Date("2026-11-23T00:00:00Z"))).toEqual([]);
  });

  // `nextTournament` is this list's head, so a Tournament it would name must come first here.
  it("agrees with nextTournament on which is first", () => {
    for (const day of ["2026-01-21", "2026-01-26", "2026-02-08", "2026-11-22"]) {
      const now = new Date(`${day}T12:00:00Z`);
      expect(upcomingTournaments(schedule, now)[0]?.name).toBe(
        nextTournament(schedule, now)?.name,
      );
    }
  });
});
