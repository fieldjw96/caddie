import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FIT_TRAITS, TRAIT_SCALES } from "../lib/fit";
import { fitTraits } from "../lib/page/data";
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

function renderRanking() {
  return render(
    <Ranking players={PLAYERS} traits={fitTraits(TRUSTED_TRAITS)} hasVenue={true} />,
  );
}

describe("Ranking", () => {
  it("orders the Players with a Fit Score on the declared Weightings", () => {
    renderRanking();
    expect(order()).toEqual(["Casey Clark", "Blair Baker", "Alex Adams"]);
  });

  it("reorders, and updates each row's numbers, when a Weighting slider moves", () => {
    renderRanking();
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

    fireEvent.click(screen.getByRole("button", { name: "Back to the declared Weightings" }));
    expect(order()).toEqual(["Casey Clark", "Blair Baker", "Alex Adams"]);
    expect(scoreOf("Blair Baker")).toBe(before);
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
    renderRanking();
    expect(order()).not.toContain("Drew Dunn");
    expect(within(noRecordSection()).getByText(/Drew Dunn/)).toBeTruthy();
  });
});
