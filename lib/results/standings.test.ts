import { describe, expect, it } from "vitest";
import { STANDINGS_TARGETS, standingsSection, thirtyStandingsRows } from "./fixtures";
import { STANDINGS_TABLE, parseStandings, readStandings } from "./standings";

function eventFor(parse: ReturnType<typeof parseStandings>, pageTitle: string) {
  const event = parse.events.find((e) => e.pageTitle === pageTitle);
  if (!event) throw new Error(`no event ${pageTitle}`);
  return event;
}

describe("parseStandings", () => {
  const parse = parseStandings(standingsSection(thirtyStandingsRows()));

  it("reads every linked event column and the Tour Championship, all marked standings", () => {
    expect(parse.failures).toEqual([]);
    expect(parse.events.map((e) => e.pageTitle)).toEqual([
      ...STANDINGS_TARGETS,
      "Tour Championship",
    ]);
    expect(parse.events.every((e) => e.basis === "standings")).toBe(true);
  });

  it("matches on the link target less its disambiguator, never the surname label", () => {
    const [first] = eventFor(parse, "2025 Players Championship").entries;
    expect(first!.name).toBe("Player Number1");
    expect(first!.candidates).toEqual(["Player Number1"]);
  });

  it("records a finish, a missed cut and a withdrawal, and nothing for a week not played", () => {
    const players = eventFor(parse, "2025 Players Championship").entries;
    expect(players[0]!.finish).toEqual({ finish: "T14", position: 14 });
    expect(eventFor(parse, "2025 PGA Championship").entries[0]!.finish).toEqual({
      finish: "CUT",
      position: null,
    });
    expect(eventFor(parse, "Memorial Tournament").entries[0]!.finish).toEqual({
      finish: "WD",
      position: null,
    });
    expect(eventFor(parse, "2025 U.S. Open (golf)").entries).toEqual([]);
    expect(eventFor(parse, "The Sentry (Hawaii)").entries).toEqual([]);
  });

  it("reads a bold win as position 1", () => {
    expect(eventFor(parse, "2025 Open Championship").entries[0]!.finish).toEqual({
      finish: "1",
      position: 1,
    });
  });

  it("stores no round scores, because the table has none", () => {
    expect(parse.events.flatMap((e) => e.entries).every((e) => e.rounds === null)).toBe(true);
  });

  it("carries a tied position down to the rows it spans, for the Tour Championship", () => {
    const entries = eventFor(parse, "Tour Championship").entries;
    expect(entries).toHaveLength(30);
    expect(entries[1]!.finish).toEqual({ finish: "T2", position: 2 });
    expect(entries[2]!.finish).toEqual({ finish: "T2", position: 2 });
  });

  it("costs one event, naming the Player and the field, when one cell is unreadable", () => {
    const rows = thirtyStandingsRows();
    rows[4]!.signature[2] = "Top 5";
    const broken = parseStandings(standingsSection(rows));

    expect(broken.failures).toHaveLength(1);
    expect(broken.failures[0]!.pageTitle).toBe("Genesis Invitational");
    expect(broken.failures[0]!.reason).toContain("Player Number5");
    expect(broken.failures[0]!.reason).toContain('"finish"');
    expect(broken.events).toHaveLength(STANDINGS_TARGETS.length);
  });

  it("refuses the Tour Championship when positions and scores disagree", () => {
    const rows = thirtyStandingsRows();
    rows[0]!.tourChampionship = " +5";
    const broken = parseStandings(standingsSection(rows));

    expect(broken.failures.map((f) => f.pageTitle)).toEqual(["Tour Championship"]);
    expect(broken.failures[0]!.reason).toContain("disagree");
  });

  it("throws when the table no longer has the thirty rows its caption promises", () => {
    expect(() => parseStandings(standingsSection(thirtyStandingsRows().slice(0, 29)))).toThrow(
      /29 marked rows, expected 30/,
    );
  });

  it("throws when the header no longer lines up with the marker groups", () => {
    const section = standingsSection(thirtyStandingsRows()).replace(
      "{{abbr|[[RBC Heritage|X]]|RBC Heritage}}",
      "RBC Heritage",
    );
    expect(() => parseStandings(section)).toThrow(/links 14 events, expected 15/);
  });

  it("throws when there is no marked table at all", () => {
    expect(() => parseStandings("===Standings===\nNo table.")).toThrow(/MajorsPly/);
  });
});

describe("readStandings", () => {
  it("reads a sound table exactly as parseStandings does", () => {
    const section = standingsSection(thirtyStandingsRows());
    expect(readStandings(section)).toEqual(parseStandings(section));
  });

  it("turns a table unreadable as a whole into one failure rather than a throw", () => {
    const parse = readStandings(standingsSection(thirtyStandingsRows().slice(0, 29)));
    expect(parse.events).toEqual([]);
    expect(parse.failures).toEqual([
      {
        pageTitle: STANDINGS_TABLE,
        basis: "standings",
        reason: expect.stringMatching(/29 marked rows, expected 30/),
      },
    ]);
  });

  it("does the same for a header that no longer lines up", () => {
    const section = standingsSection(thirtyStandingsRows()).replace(
      "{{abbr|[[RBC Heritage|X]]|RBC Heritage}}",
      "RBC Heritage",
    );
    const parse = readStandings(section);
    expect(parse.events).toEqual([]);
    expect(parse.failures[0]!.reason).toMatch(/links 14 events, expected 15/);
  });
});
