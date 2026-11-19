import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FIT_TRAITS, TRAIT_SCALES } from "../lib/fit";
import { fitTraits, type PlayerView } from "../lib/page/data";
import { PLAYERS, TRUSTED_TRAITS } from "../lib/page/fixtures";
import { Ranking } from "./ranking";

/** The ranking's own table: the one holding the Players ranked against each other. */
function rankingTable(): HTMLTableElement {
  return within(rankingSection()).getByRole("table");
}

/** The ranked Players' names, top first. Only the main ranking's table is ranked. */
function order(): string[] {
  return within(rankingTable())
    .getAllByRole("rowheader")
    .map((cell) => PLAYERS.find((p) => cell.textContent?.startsWith(p.name))?.name ?? "");
}

/** One Player's row, in whichever table holds it. */
function row(name: string): HTMLTableRowElement | null {
  return document.querySelector<HTMLTableRowElement>(`tr[data-player="${name}"]`);
}

/** The Fit Score cell's text: the score and the share of the Weighting it rests on. */
function scoreOf(name: string): string {
  const cells = [...(row(name)?.querySelectorAll("td") ?? [])];
  return cells.find((c) => c.textContent?.includes("of the Weighting"))?.textContent ?? "";
}

/** The section holding the Players whose Fit Score rests on part of the Weighting. */
function partialSection(): HTMLElement {
  return screen.getByRole("region", { name: /^Not ranked:/ });
}

function noRecordSection() {
  return screen.getByRole("region", { name: "Players with no usable record" });
}

/** The section shown when no Player has a Fit Score because of the Course or the Weightings. */
function unscoredSection() {
  return screen.getByRole("region", { name: /^No Player has a Fit Score/ });
}

/** The ranking section, whose fallback sentence shares its text with `unscoredSection`'s. */
function rankingSection() {
  return screen.getByRole("region", { name: "The roster, ordered by Fit Score" });
}

function renderRanking() {
  return render(
    <Ranking players={PLAYERS} traits={fitTraits(TRUSTED_TRAITS)} hasVenue={true} />,
  );
}

function answer(): HTMLElement {
  return screen.getByTestId("answer");
}

describe("Ranking", () => {
  it("orders the Players resting on the whole Weighting on the declared Weightings", () => {
    renderRanking();
    // Adams, whose record carries no Consistency and no Low rounds, rests on 55% of the
    // Weighting and is grouped beneath rather than ranked against the other two.
    expect(order()).toEqual(["Casey Clark", "Blair Baker"]);
    expect(within(partialSection()).getByText(/Alex Adams/)).toBeTruthy();
  });

  it("reorders, and updates each row's numbers, when a Weighting slider moves", () => {
    renderRanking();
    expect(answer().textContent).toContain("Casey Clark");
    const before = scoreOf("Blair Baker");
    for (const label of ["Length", "Slope against rating", "Mean par 4", "Longest par 4"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
    }
    fireEvent.change(screen.getByLabelText("Par 5 share"), { target: { value: "1" } });

    expect(order()).toEqual(["Blair Baker", "Casey Clark"]);
    expect(scoreOf("Blair Baker")).not.toBe(before);
    expect(scoreOf("Blair Baker")).toContain("+0.600");
    // Adams has no Low rounds, and the par 5 share, which calls for Low rounds, is now the only
    // Trait that counts: nothing known is left, so Adams moves to the no-record section, not the
    // bottom. Adams's strong Form does not save a place: Form is in no Trait.
    expect(within(noRecordSection()).getByText(/Alex Adams/)).toBeTruthy();
    // The answer is read off the same ranked result, so it now names the new leader, with
    // fewer than three Players scored.
    expect(answer().textContent).toContain("Blair Baker and Casey Clark");
    expect(answer().textContent).not.toContain("Alex Adams");
    expect(answer().textContent).toContain("Par 5 share");
    expect(answer().textContent).toContain("Low rounds");

    fireEvent.click(screen.getByRole("button", { name: "Back to the declared Weightings" }));
    expect(order()).toEqual(["Casey Clark", "Blair Baker"]);
    expect(scoreOf("Blair Baker")).toBe(before);
    expect(answer().textContent).toContain("Casey Clark");
  });

  it("states the answer above the Course section, naming the ranked Players in order and the leader's biggest Trait and Strength", () => {
    renderRanking();
    const text = answer().textContent ?? "";
    expect(text).toContain("Casey Clark and Blair Baker");
    expect(text.indexOf("Casey Clark")).toBeLessThan(text.indexOf("Blair Baker"));
    // Adams's Fit Score rests on 55% of the Weighting, so Adams is not in the order the answer
    // reads off and is not named as leading anything.
    expect(text).not.toContain("Alex Adams");
    expect(text).toContain("Length");
    expect(text).toContain("Skill");
    expect(text).not.toMatch(/\b(win|winner|favou?rite|tip|bet|odds|predict|will finish)\b/i);
  });

  it("names the leading Trait and Strength even when every known contribution is zero or negative", () => {
    // Both Players are below the middle of the field on every Strength, so every contribution
    // is negative, yet Lowe still leads by being the less negative of the two. Length is barely
    // above the bottom of its range and the other four Traits are at the top of theirs, so
    // Length is the largest contribution: the least negative one.
    const below = (skill: number, id: number, name: string): PlayerView => ({
      id,
      name,
      country: null,
      skill: { value: skill, sampleSize: 10 },
      consistency: { value: skill, sampleSize: 10 },
      lowRounds: { value: skill, sampleSize: 10 },
      form: null,
      venueRecord: null,
    });
    const players: PlayerView[] = [below(0.3, 101, "Nat Lowe"), below(0.1, 102, "Pat Reed")];
    render(
      <Ranking
        players={players}
        traits={{
          length_yards: 6_600,
          slope_rating_gap: 80,
          mean_par_4_yards: 480,
          longest_par_4_yards: 540,
          par_5_share: 5 / 18,
        }}
        hasVenue={false}
      />,
    );
    // Every Strength and every Trait is known, so both rest on the whole Weighting and are
    // ranked: this is the ranking's own case, not the partial group's.
    expect(within(rankingTable()).getAllByRole("rowheader")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: /^Not ranked:/ })).toBeNull();
    const text = answer().textContent ?? "";
    expect(text).toContain("Nat Lowe");
    expect(text).toContain("Length");
    expect(text).toContain("Skill");
  });

  it("shows a null Strength as no record with its sample, never a zero or a blank", () => {
    renderRanking();
    const adams = row("Alex Adams");
    const text = adams?.textContent ?? "";
    expect(text).toContain("no record");
    expect(text).toContain("3 results");
    expect(text).toContain("8 results");
    for (const cell of adams?.querySelectorAll("td") ?? []) {
      expect(cell.textContent?.trim()).not.toBe("");
    }
  });

  it("says which Strength each Weighting calls for, and why, not Skill for all of them", () => {
    renderRanking();
    const section = screen.getByRole("region", { name: "The Weightings" });
    const text = section.textContent ?? "";
    expect(text).toContain("Calls for Consistency.");
    expect(text).toContain("Calls for Low rounds.");
    expect(text.match(/Calls for Skill\./g)).toHaveLength(3);
    for (const trait of FIT_TRAITS) expect(text).toContain(TRAIT_SCALES[trait].why);
  });

  it("shows Form beside the Fit Score without counting it", () => {
    renderRanking();
    expect(within(row("Alex Adams")!).getByText("99%")).toBeTruthy();
    expect(screen.getByText(/shown beside the Fit Score, not counted in it/)).toBeTruthy();
  });

  it("puts a Player with no Fit Score in a section of its own, not the ranking", () => {
    // Case 3: Dunn has no Strengths at all, but the Course asks something on the declared
    // Weightings, so the other Players still score and the ranking table still renders.
    renderRanking();
    expect(order()).not.toContain("Drew Dunn");
    expect(rankingTable()).toBeTruthy();
    expect(row("Drew Dunn")).toBeNull();
    expect(within(noRecordSection()).getByText(/Drew Dunn/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: /^No Player has a Fit Score/ })).toBeNull();
  });

  it("says the Course, not the Players' record, is why nothing separates them when its only known Trait is below its range", () => {
    // Case 1: A very short course, shorter than any Tour course. Every Player here has every
    // Strength known, which is the point: the reason is the Course, not their record.
    render(<Ranking players={PLAYERS} traits={{ length_yards: 6_400 }} hasVenue={false} />);

    const blockingSentence =
      /This Course.s known Traits all sit at or below the bottom of their ranges on the current Weightings, so nothing separates the Players: Length is 6,400, at or below the minimum of 6,500\./;
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("rowheader")).toHaveLength(0);
    expect(within(rankingSection()).getByText(blockingSentence)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Players with no usable record" })).toBeNull();
    const section = unscoredSection();
    expect(within(section).getByText(blockingSentence)).toBeTruthy();
    expect(section.textContent).not.toMatch(/no usable record|no record/i);
    expect(section.textContent).not.toMatch(/enough results|results to state/i);
    for (const player of PLAYERS) {
      expect(within(section).getByText(new RegExp(player.name))).toBeTruthy();
    }
    // The short course case: the answer gives the same reason, and names no Player.
    const answerText = answer().textContent ?? "";
    expect(answerText).toMatch(/nothing separates the players/i);
    expect(answerText).toMatch(blockingSentence);
    for (const player of PLAYERS) expect(answerText).not.toContain(player.name);
  });

  it("renders Fit Scores for Port Royal at 6,842 yards, the shortest Tour course", () => {
    // Port Royal's yardage is now above the floor of 6,500, so it can separate Players. Its
    // Course here carries nothing but that yardage, so every Fit Score rests on the 30% of the
    // Weighting Length carries: nobody is ranked, and all three scoring Players are listed in
    // the partial group with their share stated.
    render(<Ranking players={PLAYERS} traits={{ length_yards: 6_842 }} hasVenue={false} />);

    const table = within(partialSection()).getByRole("table");
    // Clark, Adams, Baker: in Skill order, which is all Length calls for, and ordered among
    // themselves rather than against a ranking that does not exist.
    const scoring = ["Casey Clark", "Alex Adams", "Blair Baker"];
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => PLAYERS.find((p) => cell.textContent?.startsWith(p.name))?.name ?? ""),
    ).toEqual(scoring);
    for (const name of scoring) expect(scoreOf(name)).toContain("on 30% of the Weighting");
    // No ranking: the main table is absent rather than empty, and no row carries a number.
    expect(within(rankingSection()).queryByRole("table")).toBeNull();
    expect(table.querySelector("thead th")?.textContent).not.toBe("#");
  });

  it("says the Course has no known Fit Trait, not that the Players lack a record, when none is known", () => {
    // Case 1's other half: no known Fit Trait at all, rather than one below its range.
    render(<Ranking players={PLAYERS} traits={{}} hasVenue={false} />);
    const noTraitSentence =
      /This Course has no known Fit Trait, so nothing separates the Players\./;

    expect(within(rankingSection()).getByText(noTraitSentence)).toBeTruthy();
    const section = unscoredSection();
    expect(within(section).getByText(noTraitSentence)).toBeTruthy();
    expect(section.textContent).not.toMatch(/no usable record|no record/i);
    expect(section.textContent).not.toMatch(/enough results|results to state/i);
    const answerText = answer().textContent ?? "";
    expect(answerText).toMatch(noTraitSentence);
    for (const player of PLAYERS) expect(answerText).not.toContain(player.name);
  });

  it("does not blame a known Trait's range when a different known Trait is merely zero-weighted", () => {
    // Length is known and below its range, which is a real reason nothing separates the
    // Players. Slope against rating is also known, but sits inside its range: 70 is between
    // its 60-80. Zeroing its slider, not its value, is why it stops separating anyone, so the
    // message must not claim it sits at or below the bottom of its range too.
    render(
      <Ranking
        players={PLAYERS}
        traits={{ length_yards: 6_400, slope_rating_gap: 70 }}
        hasVenue={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Slope against rating"), {
      target: { value: "0" },
    });

    expect(screen.queryByText(/sit at or below the bottom of their ranges/)).toBeNull();
    expect(
      within(rankingSection()).getByText(
        /This Course asks something of Slope against rating, but the current Weightings count none of it: every Trait it asks something of is weighted zero\./,
      ),
    ).toBeTruthy();
  });

  it("says the Weightings, not the Course or the Players' record, are why nothing separates them when every slider is zeroed", () => {
    // Case 2: a Trait inside its range (Slope against rating, 70 of 60-80) with every slider
    // at zero. The Course asks something; the current Weightings count none of it.
    render(<Ranking players={PLAYERS} traits={{ slope_rating_gap: 70 }} hasVenue={false} />);
    const zeroedLabels = [
      "Length",
      "Slope against rating",
      "Mean par 4",
      "Longest par 4",
      "Par 5 share",
    ];
    for (const label of zeroedLabels) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
    }
    const weightingsSentence =
      /This Course asks something of Slope against rating, but the current Weightings count none of it: every Trait it asks something of is weighted zero\./;

    expect(screen.queryByRole("table")).toBeNull();
    expect(within(rankingSection()).getByText(weightingsSentence)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Players with no usable record" })).toBeNull();
    const section = unscoredSection();
    expect(within(section).getByText(weightingsSentence)).toBeTruthy();
    expect(section.textContent).not.toMatch(/no usable record|no record/i);
    expect(section.textContent).not.toMatch(/no Course Trait is known|no known Fit Trait/i);
    expect(section.textContent).not.toMatch(/results for a Strength|enough results/i);
    for (const player of PLAYERS) {
      expect(within(section).getByText(new RegExp(player.name))).toBeTruthy();
    }
    const answerText = answer().textContent ?? "";
    expect(answerText).toMatch(/nothing separates the players/i);
    expect(answerText).toMatch(weightingsSentence);
    for (const player of PLAYERS) expect(answerText).not.toContain(player.name);
  });

  it("pins the # and Player cells horizontally and lets the wrapper scroll only sideways below sm", () => {
    renderRanking();
    const table = rankingTable();
    const headerRow = table.querySelector<HTMLTableRowElement>("thead tr");
    const bodyRow = row("Casey Clark");
    const pinnedCells = [
      headerRow?.cells[0],
      headerRow?.cells[1],
      bodyRow?.cells[0],
      bodyRow?.cells[1],
    ];
    for (const cell of pinnedCells) {
      expect(cell?.className).toMatch(/\bsticky\b/);
      expect(cell?.className).toMatch(/\bleft-\S+/);
    }
    expect(headerRow?.cells).toHaveLength(13);

    const wrapper = table.parentElement;
    const classes = wrapper?.className.split(/\s+/) ?? [];
    expect(classes.filter((c) => c.includes("max-h-"))).toEqual(["sm:max-h-[36rem]"]);
    expect(classes).toContain("overflow-x-auto");
  });

  it("says no Player has enough results, naming no Player, when every Player is unscored for their record", () => {
    // Every Player here has every Strength null, but the Course asks something on the
    // declared Weightings, so this is reason 3 (the record), with nobody scored at all.
    const noRecordPlayers: typeof PLAYERS = PLAYERS.map((p) => ({
      ...p,
      skill: p.skill ? { ...p.skill, value: null } : null,
      consistency: p.consistency ? { ...p.consistency, value: null } : null,
      lowRounds: p.lowRounds ? { ...p.lowRounds, value: null } : null,
    }));
    render(
      <Ranking
        players={noRecordPlayers}
        traits={fitTraits(TRUSTED_TRAITS)}
        hasVenue={false}
      />,
    );

    expect(screen.queryByRole("table")).toBeNull();
    expect(
      within(rankingSection()).getByText(
        /No Player has a Fit Score: no Player has enough results for a Strength this Course asks for\./,
      ),
    ).toBeTruthy();
    const noRecord = noRecordSection();
    for (const player of PLAYERS) {
      expect(within(noRecord).getByText(new RegExp(player.name))).toBeTruthy();
    }
    const answerText = answer().textContent ?? "";
    expect(answerText).toMatch(/nothing separates the players/i);
    expect(answerText).toMatch(
      /no player has enough results for a strength this course asks for/i,
    );
    for (const player of PLAYERS) expect(answerText).not.toContain(player.name);
  });

  it("gives a rank number only to the Players resting on the whole Weighting", () => {
    // One Player with every Strength known and two with Skill alone, at a Course with every
    // Trait known: one rank number, and two rows beneath it carrying none.
    const partialPlayer = (id: number, name: string, skill: number): PlayerView => ({
      id,
      name,
      country: null,
      skill: { value: skill, sampleSize: 10 },
      consistency: null,
      lowRounds: null,
      form: null,
      venueRecord: null,
    });
    const players: PlayerView[] = [
      partialPlayer(201, "Wes Ward", 0.95),
      {
        ...partialPlayer(202, "Vic Vale", 0.6),
        consistency: { value: 0.6, sampleSize: 10 },
        lowRounds: { value: 0.6, sampleSize: 10 },
      },
      partialPlayer(203, "Yaz Young", 0.2),
    ];
    render(<Ranking players={players} traits={fitTraits(TRUSTED_TRAITS)} hasVenue={false} />);

    const main = rankingTable();
    const mainRows = [...main.querySelectorAll("tbody tr")];
    expect(mainRows).toHaveLength(1);
    expect(mainRows[0]?.getAttribute("data-player")).toBe("Vic Vale");
    expect(mainRows[0]?.cells[0]?.textContent?.trim()).toBe("1");
    // Ward, whose raw score is the highest of the three, is in the group beneath with no
    // number: a partial score does not take the top of an order it is not in.
    const partialRows = [
      ...within(partialSection()).getByRole("table").querySelectorAll("tbody tr"),
    ];
    expect(partialRows.map((r) => r.getAttribute("data-player"))).toEqual([
      "Wes Ward",
      "Yaz Young",
    ]);
    // Every one of their first cells is the Player's own row header, not a rank.
    for (const r of partialRows) expect(r.cells[0]?.tagName).toBe("TH");
    // And exactly one row on the whole page is numbered: one with a cell before its header.
    const numbered = [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")].filter(
      (r) => r.cells[0]?.tagName === "TD",
    );
    expect(numbered).toHaveLength(1);
    expect(numbered[0]?.getAttribute("data-player")).toBe("Vic Vale");
  });

  it("says why the group beneath is listed apart, and prints each row's Fit Score and share", () => {
    renderRanking();
    const section = partialSection();
    const heading = within(section).getByRole("heading", { level: 2 });
    expect(heading.textContent).toMatch(/^Not ranked: .*resting on part of the Weighting$/);
    expect(section.textContent).toMatch(/not on every Trait/);
    expect(section.textContent).toMatch(/adds nothing rather than being left out/);
    expect(section.textContent).toMatch(/pulls the score towards zero/);
    expect(section.textContent).toMatch(/We do not rescale it/);
    // The score itself, and the same per-row line the ranking above prints.
    expect(scoreOf("Alex Adams")).toMatch(/\+0\.\d{3}/);
    expect(scoreOf("Alex Adams")).toContain("on 55% of the Weighting");
    expect(scoreOf("Casey Clark")).toContain("on 100% of the Weighting");
    // It is the share that is stated, not a rescaled score: 0.077 is the unscaled sum, where
    // dividing by 0.55 would have read 0.140.
    expect(scoreOf("Alex Adams")).toContain("+0.077");
  });

  it("lists every Player with a Fit Score beneath, and no empty ranking, when none rests on the whole Weighting", () => {
    // Only Length is known, so every Fit Score here rests on the 30% of the Weighting it
    // carries. Nobody is ranked, and the ranking says so rather than rendering an empty table.
    render(<Ranking players={PLAYERS} traits={{ length_yards: 7_800 }} hasVenue={false} />);

    expect(within(rankingSection()).queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    const sentence =
      /No Player.s Fit Score rests on the whole Weighting, so none of them is ranked\./;
    expect(within(rankingSection()).getByText(sentence)).toBeTruthy();
    // The answer says the same thing, and does not claim nothing separates the Players: there
    // are Fit Scores, they are simply not in one order.
    const answerText = answer().textContent ?? "";
    expect(answerText).toMatch(sentence);
    expect(answerText).not.toMatch(/nothing separates the players/i);
    // Every Player with a Fit Score is shown, under the partial heading, with their share.
    const section = partialSection();
    for (const name of ["Alex Adams", "Blair Baker", "Casey Clark"]) {
      expect(within(section).getByText(new RegExp(name))).toBeTruthy();
      expect(scoreOf(name)).toContain("on 30% of the Weighting");
    }
    // Dunn has no Strength at all, so has no Fit Score: that group is unchanged.
    expect(row("Drew Dunn")).toBeNull();
    expect(within(noRecordSection()).getByText(/Drew Dunn/)).toBeTruthy();
  });

  it("renders no heading and no table for the group beneath when it is empty", () => {
    const everyStrengthKnown = PLAYERS.filter((p) =>
      ["Blair Baker", "Casey Clark"].includes(p.name),
    );
    render(
      <Ranking
        players={everyStrengthKnown}
        traits={fitTraits(TRUSTED_TRAITS)}
        hasVenue={false}
      />,
    );

    expect(order()).toEqual(["Casey Clark", "Blair Baker"]);
    expect(screen.queryByRole("region", { name: /^Not ranked:/ })).toBeNull();
    expect(screen.queryByText(/part of the Weighting/)).toBeNull();
    expect(document.querySelector("#partial-weighting")).toBeNull();
    // One table, two rows: nothing stands in for the empty group, not even an empty element.
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(document.querySelectorAll("tr[data-player]")).toHaveLength(2);
  });
});
