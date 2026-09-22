import { countRows, emptyTables, type IngestCounts } from "./counts";

// The healthy local run of 2026-09-22.
const healthy: IngestCounts = {
  tournaments: 45,
  players: 1592,
  courses: 31,
  courseTraits: 259,
  resultsBySeason: [
    { season: 2026, results: 760 },
    { season: 2025, results: 758 },
  ],
  playersWithSkill: 102,
};

describe("countRows", () => {
  it("lists every count, results season by season", () => {
    expect(countRows(healthy)).toEqual([
      ["Tournaments", 45],
      ["Players", 1592],
      ["Courses", 31],
      ["Course Traits", 259],
      ["Results, 2026 season", 760],
      ["Results, 2025 season", 758],
      ["Players with a Skill", 102],
    ]);
  });
});

describe("emptyTables", () => {
  it("is empty for a healthy run", () => {
    expect(emptyTables(healthy)).toEqual([]);
  });

  it("names a table a stage left empty while exiting 0", () => {
    expect(emptyTables({ ...healthy, courseTraits: 0, playersWithSkill: 0 })).toEqual([
      "Course Traits",
      "Players with a Skill",
    ]);
  });

  it("names results when no season has any", () => {
    expect(emptyTables({ ...healthy, resultsBySeason: [] })).toEqual([
      "Results, in any season",
    ]);
  });
});
