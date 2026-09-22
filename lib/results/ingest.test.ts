import { describe, expect, it } from "vitest";
import { buildResultRecords, type SourcedEvent } from "./ingest";
import { PlayerIndex } from "./names";
import type { ParsedEntry } from "./types";

const players = new PlayerIndex([
  { id: 1, name: "Rory McIlroy" },
  { id: 2, name: "Justin Rose" },
  { id: 3, name: "Michael Kim" },
  { id: 4, name: "Michael Kim" },
]);

const tournamentIds = new Map([
  ["2025 Masters Tournament", 10],
  ["Genesis Invitational", 11],
]);

function entry(name: string, finish: string, rounds: ParsedEntry["rounds"]): ParsedEntry {
  const position = /^T?(\d+)$/.exec(finish);
  return {
    name,
    candidates: [name],
    finish: { finish, position: position ? Number(position[1]) : null },
    rounds,
  };
}

const standings: SourcedEvent = {
  pageTitle: "2025 Masters Tournament",
  basis: "standings",
  sourceUrl: "https://en.wikipedia.org/w/index.php?title=2025_PGA_Tour&oldid=1",
  entries: [entry("Rory McIlroy", "2", null), entry("Matt Fitzpatrick", "T5", null)],
};

const leaderboard: SourcedEvent = {
  pageTitle: "2025 Masters Tournament",
  basis: "leaderboard",
  sourceUrl: "https://en.wikipedia.org/w/index.php?title=2025_Masters_Tournament&oldid=2",
  entries: [
    entry("Rory McIlroy", "T1", [72, 66, 66, 73]),
    entry("Justin Rose", "CUT", [74, 73, null, null]),
    entry("Michael Kim", "T27", [71, 71, 74, 71]),
    entry("Matt Fitzpatrick", "T40", [71, 73, 74, 73]),
  ],
};

describe("buildResultRecords", () => {
  it("keeps the leaderboard's reading over the standings', whichever comes first", () => {
    const { records } = buildResultRecords([standings, leaderboard], tournamentIds, players);
    const rory = records.find((r) => r.playerId === 1)!;

    expect(rory).toMatchObject({
      tournamentId: 10,
      basis: "leaderboard",
      finish: "T1",
      position: 1,
      round1: 72,
      round4: 73,
      source: "wikipedia",
      sourceUrl: leaderboard.sourceUrl,
    });
  });

  it("stores the rounds that were printed and null for the rest, never a stand-in", () => {
    const { records } = buildResultRecords([leaderboard], tournamentIds, players);
    const rose = records.find((r) => r.playerId === 2)!;

    expect(rose).toMatchObject({ position: null, finish: "CUT", round1: 74, round2: 73 });
    expect(rose.round3).toBeNull();
    expect(rose.round4).toBeNull();
  });

  it("gives a standings row no round scores", () => {
    const genesis = { ...standings, pageTitle: "Genesis Invitational" };
    const { records } = buildResultRecords([genesis], tournamentIds, players);
    expect(records).toEqual([
      expect.objectContaining({ basis: "standings", round1: null, round4: null }),
    ]);
  });

  it("counts every unmatched name by the lines it appeared on, and creates nobody", () => {
    const built = buildResultRecords([standings, leaderboard], tournamentIds, players);
    expect(built.unmatched).toEqual(new Map([["Matt Fitzpatrick", 2]]));
    expect(built.records.map((r) => r.playerId).sort()).toEqual([1, 2]);
  });

  it("matches an ambiguous name to nobody and reports it apart", () => {
    const built = buildResultRecords([leaderboard], tournamentIds, players);
    expect(built.ambiguous).toEqual(new Map([["Michael Kim", 1]]));
    expect(built.records.some((r) => r.playerId === 3 || r.playerId === 4)).toBe(false);
  });

  it("reports an event the schedule has no Tournament for", () => {
    const stray = { ...standings, pageTitle: "Tour Championship" };
    const built = buildResultRecords([stray], tournamentIds, players);
    expect(built.unscheduled).toEqual(["Tour Championship"]);
    expect(built.records).toEqual([]);
  });
});
