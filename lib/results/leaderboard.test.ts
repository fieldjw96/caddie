import { describe, expect, it } from "vitest";
import { fieldLines, leaderboardArticle } from "./fixtures";
import { LINES_PER_DOUBTFUL_SCORE, parseLeaderboard, readLeaderboard } from "./leaderboard";

describe("parseLeaderboard", () => {
  it("reads the final leaderboard only, not an earlier round or the scorecard", () => {
    const entries = parseLeaderboard(leaderboardArticle(fieldLines()));
    expect(entries).toHaveLength(32);
    expect(entries.map((e) => e.name)).not.toContain("Somebody Else");
    expect(entries.map((e) => e.name)).not.toContain("Scorecard Only");
  });

  it("falls back to the Final round section when there is no Final leaderboard heading", () => {
    expect(parseLeaderboard(leaderboardArticle(fieldLines(), null))).toHaveLength(32);
  });

  it("stores the rounds printed, and null for every round not printed", () => {
    const lines = [
      { place: "1", player: "[[Rory McIlroy]]", score: "72-66-66-73=277" },
      { place: "CUT", player: "[[Keegan Bradley]]", score: "74-73=147" },
      { place: "{{tooltip|WD|Withdrew}}", player: "[[Patton Kizzire]]", score: "74" },
      ...fieldLines(),
    ];
    const [winner, cut, withdrew] = parseLeaderboard(leaderboardArticle(lines));

    expect(winner!.rounds).toEqual([72, 66, 66, 73]);
    expect(cut!.rounds).toEqual([74, 73, null, null]);
    expect(cut!.finish).toEqual({ finish: "CUT", position: null });
    expect(withdrew!.rounds).toEqual([74, null, null, null]);
    expect(withdrew!.finish).toEqual({ finish: "WD", position: null });
  });

  it("reads scores written with en dashes", () => {
    const lines = [{ place: "1", player: "[[Scottie Scheffler]]", score: "68–64–67–68=267" }];
    const [first] = parseLeaderboard(leaderboardArticle([...lines, ...fieldLines()]));
    expect(first!.rounds).toEqual([68, 64, 67, 68]);
  });

  it("gives a row with no place cell the place of the tie above it", () => {
    const lines = [
      { place: "T5", player: "[[Bryson DeChambeau]]", score: "69-68-69-75=281" },
      { player: "[[Im Sung-jae]]", score: "71-70-71-69=281" },
      ...fieldLines(),
    ];
    const [, second] = parseLeaderboard(leaderboardArticle(lines));
    expect(second!.finish).toEqual({ finish: "T5", position: 5 });
  });

  it("offers the link target less its disambiguator and the label as names to match", () => {
    const lines = [
      { place: "1", player: "'''[[Matt McCarty (golfer)|Matt McCarty]]''' (c)", score: "70" },
      { place: "2", player: "Unlinked Amateur (a)", score: "71" },
      ...fieldLines(),
    ];
    const [linked, unlinked] = parseLeaderboard(leaderboardArticle(lines));
    expect(linked!.candidates).toEqual(["Matt McCarty"]);
    expect(unlinked!.name).toBe("Unlinked Amateur");
  });

  it("fails naming the line and the field when a score cell has changed shape", () => {
    const lines = fieldLines();
    lines[3]!.score = "seventy";
    expect(() => parseLeaderboard(leaderboardArticle(lines))).toThrow(
      /line 4 \(Field Player4\), field "score"/,
    );
  });

  it("keeps the finish and drops the rounds of a line whose total does not add up, and says so", () => {
    const lines = fieldLines(2 * LINES_PER_DOUBTFUL_SCORE);
    lines[0]!.score = "70 - 70 - 70 - 70 = 281";
    lines[1]!.score = "71-67-71-70-279";
    const { entries, doubtfulScores } = readLeaderboard(leaderboardArticle(lines));

    expect(entries).toHaveLength(2 * LINES_PER_DOUBTFUL_SCORE);
    expect(entries[0]!.rounds).toBeNull();
    expect(entries[0]!.finish.position).not.toBeNull();
    expect(entries[1]!.rounds).toBeNull();
    expect(entries[2]!.rounds).not.toBeNull();
    expect(doubtfulScores).toHaveLength(2);
    expect(doubtfulScores[0]).toMatch(/line 1 \(Field Player1\).*sum to 280/);
    expect(doubtfulScores[1]).toMatch(/line 2 \(Field Player2\)/);
  });

  it("fails when more score cells fail to add up than an editor's typos would explain", () => {
    const lines = fieldLines(2 * LINES_PER_DOUBTFUL_SCORE);
    for (let i = 0; i < 3; i++) lines[i]!.score = "70-70-70-70=281";
    expect(() => parseLeaderboard(leaderboardArticle(lines))).toThrow(
      /3 score cells in 40 lines/,
    );
  });

  it("reads a withdrawal before any round was finished, printed with no score, as no rounds", () => {
    const lines = [
      ...fieldLines(),
      { place: "{{tooltip|WD|Withdrew}}", player: "[[Jason Day]]", score: "–" },
      { place: "WD", player: "[[Collin Morikawa]]", score: "" },
    ];
    const entries = parseLeaderboard(leaderboardArticle(lines));
    const withdrawn = entries.filter((e) => e.finish.finish === "WD");
    expect(withdrawn.map((e) => e.rounds)).toEqual([
      [null, null, null, null],
      [null, null, null, null],
    ]);
  });

  it("still fails on an empty score cell for a Player who finished", () => {
    const lines = fieldLines();
    lines[5]!.score = "";
    expect(() => parseLeaderboard(leaderboardArticle(lines))).toThrow(
      /line 6 .*field "score"/,
    );
  });

  it("fails when a place cell is not a finish", () => {
    const lines = fieldLines();
    lines[0]!.place = "Winner";
    expect(() => parseLeaderboard(leaderboardArticle(lines))).toThrow(/field "place"/);
  });

  it("fails on a leaderboard too short to be a full field", () => {
    expect(() => parseLeaderboard(leaderboardArticle(fieldLines(10)))).toThrow(/10 lines/);
  });

  it("fails when a Player is listed twice", () => {
    const lines = fieldLines();
    lines[5]!.player = "[[Field Player1]]";
    expect(() => parseLeaderboard(leaderboardArticle(lines))).toThrow(/twice/);
  });

  it("fails when the article has no final round at all", () => {
    expect(() => parseLeaderboard("==Course==\nNothing here.")).toThrow(/Final round/);
  });
});
