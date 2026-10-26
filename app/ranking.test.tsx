import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FIT_TRAITS, TRAIT_SCALES } from "../lib/fit";
import { fitTraits, type PlayerView } from "../lib/page/data";
import { PLAYERS, TRUSTED_TRAITS } from "../lib/page/fixtures";
import { Ranking } from "./ranking";

/** The ranked Players' names, top first. */
function order(): string[] {
  return within(screen.getByRole("table"))
    .getAllByRole("rowheader")
    .map((cell) => PLAYERS.find((p) => cell.textContent?.startsWith(p.name))?.name ?? "");
}

function row(name: string): HTMLTableRowElement | null {
  return screen.getByRole("table").querySelector(`tr[data-player="${name}"]`);
}

/** The Fit Score cell's text: the score and the Weighting it rests on. */
function scoreOf(name: string): string {
  return row(name)?.querySelectorAll("td")[1]?.textContent ?? "";
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
  it("orders the Players with a Fit Score on the declared Weightings", () => {
    renderRanking();
    expect(order()).toEqual(["Casey Clark", "Blair Baker", "Alex Adams"]);
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
    expect(order()).toEqual(["Casey Clark", "Blair Baker", "Alex Adams"]);
    expect(scoreOf("Blair Baker")).toBe(before);
    expect(answer().textContent).toContain("Casey Clark");
  });

  it("states the answer above the Course section, naming the top three Players in order and the leader's biggest Trait and Strength", () => {
    renderRanking();
    const text = answer().textContent ?? "";
    expect(text).toContain("Casey Clark, Blair Baker and Alex Adams");
    expect(text.indexOf("Casey Clark")).toBeLessThan(text.indexOf("Blair Baker"));
    expect(text.indexOf("Blair Baker")).toBeLessThan(text.indexOf("Alex Adams"));
    expect(text).toContain("Length");
    expect(text).toContain("Skill");
    expect(text).not.toMatch(/\b(win|winner|favou?rite|tip|bet|odds|predict|will finish)\b/i);
  });

  it("names the leading Trait and Strength even when every known contribution is zero or negative", () => {
    // Only length_yards is known, at the top of its range, so it is the one Trait that can
    // separate these Players; both are below the middle on Skill, so every known contribution
    // is negative, yet Lowe still leads by being the less negative of the two.
    const players: PlayerView[] = [
      {
        id: 101,
        name: "Nat Lowe",
        country: null,
        skill: { value: 0.3, sampleSize: 10 },
        consistency: null,
        lowRounds: null,
        form: null,
        venueRecord: null,
      },
      {
        id: 102,
        name: "Pat Reed",
        country: null,
        skill: { value: 0.1, sampleSize: 10 },
        consistency: null,
        lowRounds: null,
        form: null,
        venueRecord: null,
      },
    ];
    render(<Ranking players={players} traits={{ length_yards: 7_800 }} hasVenue={false} />);
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
    expect(screen.getByRole("table")).toBeTruthy();
    expect(within(noRecordSection()).getByText(/Drew Dunn/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: /^No Player has a Fit Score/ })).toBeNull();
  });

  it("says the Course, not the Players' record, is why nothing separates them when its only known Trait is below its range", () => {
    // Case 1: Port Royal's only known Trait, length, falls below the bottom of its range. Every
    // Player here has every Strength known, which is the point: the reason is the Course, not
    // their record.
    render(<Ranking players={PLAYERS} traits={{ length_yards: 6_800 }} hasVenue={false} />);

    const blockingSentence =
      /This Course.s known Traits all sit at or below the bottom of their ranges on the current Weightings, so nothing separates the Players: Length is 6,800, at or below the minimum of 6,900\./;
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
    // The Port Royal case: the answer gives the same reason, and names no Player.
    const answerText = answer().textContent ?? "";
    expect(answerText).toMatch(/nothing separates the players/i);
    expect(answerText).toMatch(blockingSentence);
    for (const player of PLAYERS) expect(answerText).not.toContain(player.name);
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
        traits={{ length_yards: 6_800, slope_rating_gap: 70 }}
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
    const table = screen.getByRole("table");
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
});
