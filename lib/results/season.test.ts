import { describe, expect, it } from "vitest";
import type { ScheduleRow } from "../schedule/parse";
import { defaultSeasons, enoughEvents, eventArticles } from "./season";

function row(pageTitle: string, endDate: string, canceled = false): ScheduleRow {
  return { name: pageTitle, pageTitle, startDate: endDate, endDate, location: null, canceled };
}

const schedule2026: ScheduleRow[] = [
  row("Genesis Invitational", "2026-02-22"),
  row("2026 Players Championship", "2026-03-15"),
  row("2026 Masters Tournament", "2026-04-12"),
  row("2026 Open Championship", "2026-07-19"),
  row("2026 Tour Championship", "2026-09-22"),
  row("2026 Zurich Classic", "2026-10-04"),
  row("2026 Canceled Invitational", "2026-01-11", true),
];

describe("defaultSeasons", () => {
  it("reads last season and this one, because the Form window straddles New Year", () => {
    expect(defaultSeasons("2026-09-22")).toEqual([2025, 2026]);
    expect(defaultSeasons("2027-02-01")).toEqual([2026, 2027]);
  });
});

describe("eventArticles", () => {
  it("reads the season's edition articles whose events have finished", () => {
    const { played } = eventArticles(schedule2026, 2026, "2026-09-22");
    expect(played).toEqual([
      "2026 Players Championship",
      "2026 Masters Tournament",
      "2026 Open Championship",
    ]);
  });

  it("counts, and does not read, events still to be played, including one ending today", () => {
    const { notYetPlayed } = eventArticles(schedule2026, 2026, "2026-09-22");
    expect(notYetPlayed).toEqual(["2026 Tour Championship", "2026 Zurich Classic"]);
  });

  it("ignores events with no edition article of their own, and canceled ones", () => {
    const { played, notYetPlayed } = eventArticles(schedule2026, 2026, "2026-12-31");
    expect([...played, ...notYetPlayed]).not.toContain("Genesis Invitational");
    expect([...played, ...notYetPlayed]).not.toContain("2026 Canceled Invitational");
  });

  it("reads another season's articles only for that season", () => {
    expect(eventArticles(schedule2026, 2025, "2026-09-22")).toEqual({
      played: [],
      notYetPlayed: [],
    });
  });

  it("lists an article linked from two rows once", () => {
    const rows = [
      row("2026 FedEx Cup Playoffs", "2026-08-16"),
      row("2026 FedEx Cup Playoffs", "2026-08-23"),
    ];
    expect(eventArticles(rows, 2026, "2026-09-22").played).toEqual([
      "2026 FedEx Cup Playoffs",
    ]);
  });
});

describe("enoughEvents", () => {
  it("holds a season with standings to the bar of a complete season", () => {
    expect(enoughEvents(6, { hasStandings: true, leaderboardsRead: 5 })).toBe(true);
    expect(enoughEvents(5, { hasStandings: true, leaderboardsRead: 5 })).toBe(false);
  });

  it("accepts a season in progress with most of its leaderboards read", () => {
    expect(enoughEvents(5, { hasStandings: false, leaderboardsRead: 5 })).toBe(true);
    expect(enoughEvents(3, { hasStandings: false, leaderboardsRead: 5 })).toBe(true);
  });

  it("refuses a season in progress whose leaderboards mostly yielded nothing", () => {
    expect(enoughEvents(2, { hasStandings: false, leaderboardsRead: 5 })).toBe(false);
    expect(enoughEvents(0, { hasStandings: false, leaderboardsRead: 1 })).toBe(false);
  });

  it("does not refuse a season with nothing played yet", () => {
    expect(enoughEvents(0, { hasStandings: false, leaderboardsRead: 0 })).toBe(true);
  });
});
