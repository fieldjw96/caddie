import { describe, expect, it } from "vitest";
import { isolateOfficialScheduleTable, parseSchedule } from "./parse";

const SECTION_WIKITEXT = `The following table lists official events during the 2026 season.<ref>...</ref>

{| class="wikitable" style="font-size:95%"
!Date
!Tournament
!Location
!Purse<br>(US$)
!Winner(s)
!OWGR<br>points
!Other<br>tours
!Notes
|-style="background:#D6E8FF;"
|<s>Jan 11</s>
|[[The Sentry (Hawaii)|The Sentry]]
|Hawaii
|align=center|–
|''Canceled''
|align=center|–
|
|Signature event
|-
|Jan 18
|[[Sony Open in Hawaii]]
|Hawaii
|align=right|9,100,000
|{{flagicon|USA}} [[Chris Gotterup]] (3)
|align=center|46.95
|
|
|- style="background:#e5d1cb;"
|Apr 12
|'''[[2026 Masters Tournament|Masters Tournament]]'''
|Georgia
|align=right|22,500,000
|{{flagicon|NIR}} '''[[Rory McIlroy]]''' (30)
|align=center|100
|
|[[Men's major golf championships|Major championship]]
|-
|Apr 26
|[[Zurich Classic of New Orleans]]
|Louisiana
|align=right|9,500,000
|{{flagicon|ENG}} [[Alex Fitzpatrick]] (1) and<br>{{flagicon|ENG}} [[Matt Fitzpatrick]] (5)
|align=center|n/a
|
||Team event
|}

===Unofficial events===
The following events are sanctioned by the PGA Tour, but do not carry FedEx Cup points.

{| class="wikitable" style="font-size:95%"
!Date
!Tournament
!Location
!Purse
!Winner(s)
!OWGR
!Notes
|-
|Sep 27
|[[2026 Presidents Cup|Presidents Cup]]
|Illinois
|align=center|n/a
|{{flagdeco|}}
|align=center|n/a
|Team event
|}
`;

describe("isolateOfficialScheduleTable", () => {
  it("cuts the official table off before the nested Unofficial events subsection", () => {
    const table = isolateOfficialScheduleTable(SECTION_WIKITEXT);
    expect(table).toContain("Zurich Classic of New Orleans");
    expect(table).not.toContain("Presidents Cup");
  });
});

describe("parseSchedule", () => {
  const rows = parseSchedule(SECTION_WIKITEXT, 2026);

  it("parses one row per tournament, including the canceled one", () => {
    expect(rows).toHaveLength(4);
  });

  it("flags the struck-through, Canceled row without dropping it", () => {
    expect(rows[0]).toMatchObject({
      name: "The Sentry",
      pageTitle: "The Sentry (Hawaii)",
      canceled: true,
    });
  });

  it("turns 'Mon D' plus the season into an ISO start date, and adds three days for the end date", () => {
    expect(rows[1]).toMatchObject({
      name: "Sony Open in Hawaii",
      startDate: "2026-01-18",
      endDate: "2026-01-21",
      canceled: false,
    });
  });

  it("keeps the Location cell as plain text", () => {
    expect(rows.map((row) => row.location)).toEqual([
      "Hawaii",
      "Hawaii",
      "Georgia",
      "Louisiana",
    ]);
  });

  it("strips bold markup from a major's name and link", () => {
    expect(rows[2]).toMatchObject({
      name: "Masters Tournament",
      pageTitle: "2026 Masters Tournament",
    });
  });

  it("handles the '||' inline-cell row without losing or merging columns", () => {
    expect(rows[3]).toMatchObject({
      name: "Zurich Classic of New Orleans",
      pageTitle: "Zurich Classic of New Orleans",
      canceled: false,
    });
  });

  it("fails loudly, naming the row and the field, when a row has too few columns", () => {
    const shortRow = SECTION_WIKITEXT.replace(
      "|align=center|46.95\n|\n|\n|-",
      "|align=center|46.95\n|-",
    );
    expect(() => parseSchedule(shortRow, 2026)).toThrow(/Schedule row 2/);
    expect(() => parseSchedule(shortRow, 2026)).toThrow(/8 columns/);
  });

  it("fails loudly when the Tournament cell is not a single wikilink", () => {
    const brokenLink = SECTION_WIKITEXT.replace(
      "|[[Sony Open in Hawaii]]",
      "|Sony Open in Hawaii",
    );
    expect(() => parseSchedule(brokenLink, 2026)).toThrow(/Tournament.*wikilink/);
  });

  it("throws when the section has no wikitable at all", () => {
    expect(() => parseSchedule("Nothing but prose here.", 2026)).toThrow(/no wikitable/);
  });
});
