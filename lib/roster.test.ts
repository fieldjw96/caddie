import { describe, expect, it } from "vitest";
import { rosterCutoff, ROSTER_WINDOW_MONTHS, selectRoster } from "./roster";

const ASOF = "2026-09-22";

describe("rosterCutoff", () => {
  it("is ROSTER_WINDOW_MONTHS months before the as-of date", () => {
    expect(ROSTER_WINDOW_MONTHS).toBe(12);
    expect(rosterCutoff(ASOF)).toBe("2025-09-22");
  });
});

describe("selectRoster", () => {
  it("keeps a Player with a Result inside the window", () => {
    const players = [{ id: 1 }, { id: 2 }];
    const results = [{ playerId: 1, endDate: "2026-06-01" }];
    expect(selectRoster(players, results, ASOF)).toEqual([{ id: 1 }]);
  });

  it("keeps a Player whose Result falls exactly on the cutoff", () => {
    const players = [{ id: 1 }];
    const results = [{ playerId: 1, endDate: rosterCutoff(ASOF) }];
    expect(selectRoster(players, results, ASOF)).toEqual([{ id: 1 }]);
  });

  it("drops a Player whose Result falls one day short of the cutoff", () => {
    const players = [{ id: 1 }];
    const cutoff = rosterCutoff(ASOF);
    const dayBefore = new Date(`${cutoff}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const results = [{ playerId: 1, endDate: dayBefore.toISOString().slice(0, 10) }];
    expect(selectRoster(players, results, ASOF)).toEqual([]);
  });

  it("drops a Player with no stored Result at all", () => {
    const players = [{ id: 1 }, { id: 2 }];
    const results = [{ playerId: 1, endDate: "2026-06-01" }];
    expect(selectRoster(players, results, ASOF)).toEqual([{ id: 1 }]);
    expect(selectRoster(players, results, ASOF).map((p) => p.id)).not.toContain(2);
  });

  it("counts either basis: a standings-only Result still keeps a Player on the roster", () => {
    // selectRoster takes only playerId and endDate, so a standings row's lack of round
    // scores and position never enters into it: presence of the row is the signal.
    const players = [{ id: 1 }];
    const results = [{ playerId: 1, endDate: "2026-08-01" }];
    expect(selectRoster(players, results, ASOF)).toEqual([{ id: 1 }]);
  });

  it("counts a Player once even with several qualifying Results", () => {
    const players = [{ id: 1 }];
    const results = [
      { playerId: 1, endDate: "2026-01-01" },
      { playerId: 1, endDate: "2026-06-01" },
    ];
    expect(selectRoster(players, results, ASOF)).toEqual([{ id: 1 }]);
  });

  it("returns an empty roster for an empty player table rather than throwing", () => {
    expect(selectRoster([], [], ASOF)).toEqual([]);
  });

  it("returns a new array rather than the input reference", () => {
    const players = [{ id: 1 }];
    const results = [{ playerId: 1, endDate: "2026-06-01" }];
    expect(selectRoster(players, results, ASOF)).not.toBe(players);
  });
});
