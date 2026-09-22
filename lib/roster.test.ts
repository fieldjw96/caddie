import { describe, expect, it } from "vitest";
import { selectRoster } from "./roster";

describe("selectRoster", () => {
  it("ranks every ingested player, absent a better signal", () => {
    const players = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(selectRoster(players)).toEqual(players);
  });

  it("returns an empty roster for an empty table rather than throwing", () => {
    expect(selectRoster([])).toEqual([]);
  });

  it("returns a new array rather than the input reference", () => {
    const players = [{ id: 1 }];
    expect(selectRoster(players)).not.toBe(players);
  });
});
