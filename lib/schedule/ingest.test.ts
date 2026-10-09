import { describe, expect, it, vi } from "vitest";
import {
  buildTournamentRecords,
  resolveCourseFacts,
  type TournamentArticleCourse,
} from "./ingest";
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

const WAIALAE: TournamentArticleCourse = {
  name: "Waialae Country Club",
  par: 70,
  yardage: 7044,
  articleUrl: "https://en.wikipedia.org/w/index.php?title=Sony_Open_in_Hawaii&oldid=7",
};

describe("buildTournamentRecords", () => {
  it("drops canceled rows and never invents a courses row", () => {
    const records = buildTournamentRecords(
      ROWS,
      2026,
      "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
      new Map([["Sony Open in Hawaii", WAIALAE]]),
    );

    expect(records).toHaveLength(2);
    expect(records.every((r) => !("courseId" in r))).toBe(true);
  });

  it("carries the Course name, par and yardage as the article states them", () => {
    const records = buildTournamentRecords(
      ROWS,
      2026,
      "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
      new Map([["Sony Open in Hawaii", WAIALAE]]),
    );

    expect(records[0]).toMatchObject({
      name: "Sony Open in Hawaii",
      courseName: "Waialae Country Club",
      coursePar: 70,
      courseYardage: 7044,
      courseArticleUrl: WAIALAE.articleUrl,
      source: "wikipedia",
    });
  });

  it("leaves every Course fact null for an article that could not be read", () => {
    const records = buildTournamentRecords(
      ROWS,
      2026,
      "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
      new Map([["Sony Open in Hawaii", WAIALAE]]),
    );

    expect(records[1]).toMatchObject({
      name: "The American Express",
      courseName: null,
      coursePar: null,
      courseYardage: null,
      courseArticleUrl: null,
    });
  });

  it("keeps a fact the article does not state, without losing the revision it was read at", () => {
    const silent: TournamentArticleCourse = {
      name: "TPC Somewhere",
      par: null,
      yardage: null,
      articleUrl: "https://en.wikipedia.org/w/index.php?title=X&oldid=9",
    };
    const records = buildTournamentRecords(
      ROWS,
      2026,
      "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
      new Map([["Sony Open in Hawaii", silent]]),
    );

    expect(records[0]).toMatchObject({
      courseName: "TPC Somewhere",
      coursePar: null,
      courseYardage: null,
      courseArticleUrl: silent.articleUrl,
    });
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

vi.mock("./wikipedia", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wikipedia")>()),
  fetchArticle: vi.fn(),
}));

describe("resolveCourseFacts", () => {
  it("reads every Course fact from the one article it already fetches", async () => {
    const { fetchArticle } = await import("./wikipedia");
    vi.mocked(fetchArticle).mockImplementation((title: string) => {
      if (title === "Sony Open in Hawaii") {
        return Promise.resolve({
          title,
          revid: 7,
          wikitext:
            "{{Infobox golf tournament\n| course = [[Waialae Country Club]]\n" +
            "| par = 70\n| yardage = {{convert|7,044|yd|m}}\n}}",
        });
      }
      return Promise.reject(new Error("network trouble"));
    });

    const facts = await resolveCourseFacts(["Sony Open in Hawaii", "The American Express"]);

    expect(facts.get("Sony Open in Hawaii")).toEqual({
      name: "Waialae Country Club",
      par: 70,
      yardage: 7044,
      articleUrl: "https://en.wikipedia.org/w/index.php?title=Sony_Open_in_Hawaii&oldid=7",
    });
  });

  it("leaves out an article that could not be read, and never blocks on one failing", async () => {
    const { fetchArticle } = await import("./wikipedia");
    vi.mocked(fetchArticle).mockImplementation((title: string) =>
      title === "Sony Open in Hawaii"
        ? Promise.resolve({
            title,
            revid: 7,
            wikitext: "{{Infobox golf tournament\n| course = [[Waialae Country Club]]\n}}",
          })
        : Promise.reject(new Error("network trouble")),
    );

    const facts = await resolveCourseFacts(["Sony Open in Hawaii", "The American Express"]);

    expect(facts.has("The American Express")).toBe(false);
    expect(facts.get("Sony Open in Hawaii")).toMatchObject({
      name: "Waialae Country Club",
      par: null,
      yardage: null,
    });
  });
});
