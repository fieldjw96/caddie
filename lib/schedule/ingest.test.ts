import { describe, expect, it, vi } from "vitest";
import { buildTournamentRecords, resolveCourseNames } from "./ingest";
import type { ScheduleRow } from "./parse";

const ROWS: ScheduleRow[] = [
  {
    name: "The Sentry",
    pageTitle: "The Sentry (Hawaii)",
    startDate: "2026-01-11",
    endDate: "2026-01-14",
    location: null,
    canceled: true,
  },
  {
    name: "Sony Open in Hawaii",
    pageTitle: "Sony Open in Hawaii",
    startDate: "2026-01-18",
    endDate: "2026-01-21",
    location: null,
    canceled: false,
  },
  {
    name: "The American Express",
    pageTitle: "The American Express",
    startDate: "2026-01-25",
    endDate: "2026-01-28",
    location: null,
    canceled: false,
  },
];

describe("buildTournamentRecords", () => {
  it("drops canceled rows and never invents a courses row", () => {
    const records = buildTournamentRecords(
      ROWS,
      2026,
      "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
      new Map([
        ["Sony Open in Hawaii", "Waialae Country Club"],
        ["The American Express", null],
      ]),
    );

    expect(records).toHaveLength(2);
    expect(records.every((r) => !("courseId" in r))).toBe(true);
  });

  it("carries the resolved Course name as written, or null when unresolved", () => {
    const records = buildTournamentRecords(
      ROWS,
      2026,
      "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
      new Map([["Sony Open in Hawaii", "Waialae Country Club"]]),
    );

    expect(records[0]).toMatchObject({
      name: "Sony Open in Hawaii",
      courseName: "Waialae Country Club",
      source: "wikipedia",
    });
    expect(records[1]).toMatchObject({ name: "The American Express", courseName: null });
  });

  it("stamps every record with the season and the given source URL", () => {
    const sourceUrl = "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=42";
    const records = buildTournamentRecords(ROWS, 2026, sourceUrl, new Map());
    for (const record of records) {
      expect(record.season).toBe(2026);
      expect(record.sourceUrl).toBe(sourceUrl);
      expect(record.source).toBe("wikipedia");
    }
  });
});

vi.mock("./wikipedia", () => ({
  fetchArticle: vi.fn(),
}));

describe("resolveCourseNames", () => {
  it("resolves a Course name per article and never blocks on one failing", async () => {
    const { fetchArticle } = await import("./wikipedia");
    vi.mocked(fetchArticle).mockImplementation((title: string) => {
      if (title === "Sony Open in Hawaii") {
        return Promise.resolve({
          title,
          revid: 1,
          wikitext: "{{Infobox golf tournament\n| course = [[Waialae Country Club]]\n}}",
        });
      }
      return Promise.reject(new Error("network trouble"));
    });

    const names = await resolveCourseNames(["Sony Open in Hawaii", "The American Express"]);

    expect(names.get("Sony Open in Hawaii")).toBe("Waialae Country Club");
    expect(names.get("The American Express")).toBeNull();
  });
});
