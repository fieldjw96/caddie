import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
    // Adams has no Form, and the par 5 share, which calls for Form, is now the only Trait that
    // counts: nothing known is left, so Adams moves to the no-record section, not the bottom.
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

  it("puts a Player with no Fit Score in a section of its own, not the ranking", () => {
    renderRanking();
    expect(order()).not.toContain("Drew Dunn");
    expect(within(noRecordSection()).getByText(/Drew Dunn/)).toBeTruthy();
  });
});
