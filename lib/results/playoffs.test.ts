import { describe, expect, it } from "vitest";
import { parsePlayoffs, PLAYOFFS_TABLE, readPlayoffs } from "./playoffs";

const HEADER = `{|class="wikitable sortable" style=text-align:center
!rowspan=2|
!rowspan=2|Player
!colspan=2|Pre-Playoffs
!colspan=2|[[FedEx St. Jude Championship|FedEx St. Jude<br>Championship]]
!colspan=2|[[BMW Championship (PGA Tour)|BMW<br>Championship]]
!colspan=2|[[Tour Championship]]
|-
!Points
!Rank
!Finish
!Rank<br/>after
!Finish
!Rank<br/>after
!Finish
!Final<br/>rank`;

function row(player: string, stJude: string, bmw: string, tour: string): string {
  return `|-
|{{flagicon|USA}}
|align=left|${player}
|1,257
|28
|${stJude}
|30
|${bmw}
|style="background:#F08080;"|33
|${tour}
|{{nts|33}}`;
}

const NOT_ADVANCED = "{{ntsh|102}}–";

function filler(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    row(`{{sortname|Field|Player${i + 1}}}`, `{{nts|${i + 10}}}`, NOT_ADVANCED, NOT_ADVANCED),
  );
}

function article(rows: string[]): string {
  return `==Playoff tournaments==
Text.

==Table of qualified players==
Table key:<br/>
${HEADER}
${rows.join("\n")}
|}
DNP = did not play

==References==
{{reflist}}`;
}

describe("parsePlayoffs", () => {
  it("reads each event's finishes, keyed by the article its header links", () => {
    const rows = [
      row(
        "{{sortname|Scottie|Scheffler}}",
        'style="background:lime;"|{{nts|1}}',
        "{{nts|12|prefix=T}}",
        "{{nts|1}}",
      ),
      row(
        "{{sortname|Adam|Scott|dab=golfer}}*",
        "{{nts|12|prefix=T}}",
        "{{ntsh|99}}WD",
        NOT_ADVANCED,
      ),
      ...filler(30),
    ];
    const { events, failures } = parsePlayoffs(article(rows));

    expect(failures).toEqual([]);
    expect(events.map((e) => e.pageTitle)).toEqual([
      "FedEx St. Jude Championship",
      "BMW Championship (PGA Tour)",
      "Tour Championship",
    ]);
    expect(events.every((e) => e.basis === "standings")).toBe(true);
    const [stJude, bmw, tour] = events;
    expect(stJude!.entries).toHaveLength(32);
    expect(stJude!.entries[0]).toEqual({
      name: "Scottie Scheffler",
      candidates: ["Scottie Scheffler"],
      finish: { finish: "1", position: 1 },
      rounds: null,
    });
    expect(stJude!.entries[1]!.finish).toEqual({ finish: "T12", position: 12 });
    expect(bmw!.entries.map((e) => e.finish.finish)).toEqual(["T12", "WD"]);
    expect(tour!.entries.map((e) => e.name)).toEqual(["Scottie Scheffler"]);
  });

  it("matches on the sortname's link target, less its disambiguator, and its name", () => {
    const rows = [
      row("{{sortname|Adam|Scott|dab=golfer}}*", "{{nts|12}}", NOT_ADVANCED, NOT_ADVANCED),
      row(
        "{{sortname|Im|Sung-jae||Im, Sung-jae}}",
        "{{nts|17|prefix=T}}",
        NOT_ADVANCED,
        NOT_ADVANCED,
      ),
      ...filler(30),
    ];
    const [stJude] = parsePlayoffs(article(rows)).events;
    expect(stJude!.entries[0]!.candidates).toEqual(["Adam Scott"]);
    expect(stJude!.entries[1]!.name).toBe("Im Sung-jae");
    expect(stJude!.entries[1]!.finish.finish).toBe("T17");
  });

  it("records nothing for an event a Player did not advance to or did not play", () => {
    const rows = [row("[[Somebody Else]]", "DNP", NOT_ADVANCED, "—"), ...filler(30)];
    const [stJude, bmw, tour] = parsePlayoffs(article(rows)).events;
    expect(stJude!.entries.map((e) => e.name)).not.toContain("Somebody Else");
    expect(bmw!.entries).toEqual([]);
    expect(tour!.entries).toEqual([]);
  });

  it("costs one event, naming the line and the field, when one of its cells is not a finish", () => {
    const rows = [...filler(30), row("[[Bad Cell]]", "{{nts|3}}", "Winner", NOT_ADVANCED)];
    const { events, failures } = parsePlayoffs(article(rows));
    expect(events.map((e) => e.pageTitle)).toEqual([
      "FedEx St. Jude Championship",
      "Tour Championship",
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.pageTitle).toBe("BMW Championship (PGA Tour)");
    expect(failures[0]!.reason).toMatch(/line 31 \(Bad Cell\), field "finish"/);
  });

  it("fails on a table with fewer Players than the Tour Championship's field", () => {
    expect(() => parsePlayoffs(article(filler(10)))).toThrow(/10 Players/);
  });

  it("fails on an article with no qualified players table", () => {
    expect(() => parsePlayoffs("==Playoff tournaments==\nNothing yet.")).toThrow(
      /Table of qualified players/,
    );
  });
});

describe("readPlayoffs", () => {
  it("turns a table unreadable as a whole into one failure, not a thrown error", () => {
    const { events, failures } = readPlayoffs("==Overview==\nNothing yet.");
    expect(events).toEqual([]);
    expect(failures.map((f) => f.pageTitle)).toEqual([PLAYOFFS_TABLE]);
  });
});
