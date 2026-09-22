import { describe, expect, it, vi } from "vitest";
import { fetchCourseFacts } from "./wikipedia-ingest";

vi.mock("../schedule/wikipedia", () => {
  class MissingArticleError extends Error {
    constructor(readonly page: string) {
      super(`Wikipedia has no article titled "${page}".`);
      this.name = "MissingArticleError";
    }
  }
  return {
    MissingArticleError,
    fetchIntro: vi.fn(),
    searchArticles: vi.fn(),
    revisionUrl: (title: string, revid: number) =>
      `https://en.wikipedia.org/w/index.php?title=${title.replaceAll(" ", "_")}&oldid=${revid}`,
  };
});

const BETHPAGE_WIKITEXT =
  "{{Infobox golf facility\n| elevation = {{convert|125|ft}}\n| greens = [[Poa annua]]\n}}";

describe("fetchCourseFacts", () => {
  it("reads both facts and the revision URL for a Course whose article resolves by its Wikipedia-native name", async () => {
    const { fetchIntro } = await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockResolvedValue({
      title: "Bethpage Black Course",
      revid: 42,
      wikitext: BETHPAGE_WIKITEXT,
    });

    const outcomes = await fetchCourseFacts([
      { id: 1, name: "Bethpage Black Course", wikipediaName: "Bethpage Black Course" },
    ]);

    expect(outcomes).toEqual([
      {
        status: "read",
        courseId: 1,
        name: "Bethpage Black Course",
        altitudeFeet: 125,
        greenSurface: "Poa annua",
        sourceUrl: "https://en.wikipedia.org/w/index.php?title=Bethpage_Black_Course&oldid=42",
      },
    ]);
    expect(fetchIntro).toHaveBeenCalledWith("Bethpage Black Course");
  });

  it("never tries OpenGolfAPI's name directly: a title differing only from it is fetched instead", async () => {
    const { fetchIntro } = await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockResolvedValue({
      title: "TPC Deere Run",
      revid: 5,
      wikitext: "{{Infobox golf facility\n| elevation = {{convert|560|ft}}\n}}",
    });

    const outcomes = await fetchCourseFacts([
      { id: 1, name: "Tpc Deere Run", wikipediaName: "TPC Deere Run" },
    ]);

    expect(fetchIntro).toHaveBeenCalledWith("TPC Deere Run");
    expect(fetchIntro).not.toHaveBeenCalledWith("Tpc Deere Run");
    expect(outcomes[0]).toMatchObject({ status: "read", altitudeFeet: 560 });
  });

  it("reports a Course whose article fetch fails outright, without trying search", async () => {
    const { fetchIntro, searchArticles } = await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockRejectedValue(new Error("HTTP 503"));

    const outcomes = await fetchCourseFacts([
      { id: 1, name: "No Such Course", wikipediaName: "No Such Course" },
    ]);

    expect(outcomes[0]).toEqual({
      status: "no-article",
      courseId: 1,
      name: "No Such Course",
      reason: "HTTP 503",
    });
    expect(searchArticles).not.toHaveBeenCalled();
  });

  it("falls back to search, and accepts a result differing only in capitalisation", async () => {
    const { fetchIntro, searchArticles, MissingArticleError } =
      await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockImplementation((title: string) => {
      if (title === "Tpc Deere Run") return Promise.reject(new MissingArticleError(title));
      return Promise.resolve({
        title,
        revid: 11,
        wikitext: "{{Infobox golf facility\n| elevation = {{convert|560|ft}}\n}}",
      });
    });
    vi.mocked(searchArticles).mockResolvedValue([{ title: "TPC Deere Run" }]);

    const outcomes = await fetchCourseFacts([
      { id: 1, name: "Tpc Deere Run", wikipediaName: "Tpc Deere Run" },
    ]);

    expect(searchArticles).toHaveBeenCalledWith("Tpc Deere Run");
    expect(fetchIntro).toHaveBeenCalledWith("TPC Deere Run");
    expect(outcomes[0]).toMatchObject({ status: "read", altitudeFeet: 560 });
  });

  it("falls back to search, and accepts a result missing a course suffix Wikipedia doesn't use", async () => {
    const { fetchIntro, searchArticles, MissingArticleError } =
      await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockImplementation((title: string) => {
      if (title === "Memorial Park Golf Course") {
        return Promise.reject(new MissingArticleError(title));
      }
      return Promise.resolve({
        title,
        revid: 22,
        wikitext: "{{Infobox golf facility\n| greens = Bentgrass\n}}",
      });
    });
    vi.mocked(searchArticles).mockResolvedValue([{ title: "Memorial Park" }]);

    const outcomes = await fetchCourseFacts([
      {
        id: 1,
        name: "Memorial Park Municipal Golf Course",
        wikipediaName: "Memorial Park Golf Course",
      },
    ]);

    expect(fetchIntro).toHaveBeenCalledWith("Memorial Park");
    expect(outcomes[0]).toMatchObject({ status: "read", greenSurface: "Bentgrass" });
  });

  it("records nothing when the exact title misses and search finds nothing confident", async () => {
    const { fetchIntro, searchArticles, MissingArticleError } =
      await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockRejectedValue(new MissingArticleError("Black Desert Resort"));
    vi.mocked(searchArticles).mockResolvedValue([
      { title: "Desert Inn" },
      { title: "Bank of Utah Championship" },
    ]);

    const outcomes = await fetchCourseFacts([
      { id: 1, name: "Black Desert Resort", wikipediaName: "Black Desert Resort" },
    ]);

    expect(outcomes[0]).toEqual({
      status: "no-article",
      courseId: 1,
      name: "Black Desert Resort",
      reason:
        'search for "Black Desert Resort" found no single confident match, only: Desert Inn, Bank of Utah Championship',
    });
  });

  it("records nothing when search itself returns nothing", async () => {
    const { fetchIntro, searchArticles, MissingArticleError } =
      await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockRejectedValue(new MissingArticleError("Nowhere Golf Club"));
    vi.mocked(searchArticles).mockResolvedValue([]);

    const outcomes = await fetchCourseFacts([
      { id: 1, name: "Nowhere Golf Club", wikipediaName: "Nowhere Golf Club" },
    ]);

    expect(outcomes[0]).toEqual({
      status: "no-article",
      courseId: 1,
      name: "Nowhere Golf Club",
      reason: 'search for "Nowhere Golf Club" found nothing',
    });
  });

  it("searches on OpenGolfAPI's name when the schedule gave no Wikipedia-native name at all", async () => {
    const { searchArticles } = await import("../schedule/wikipedia");
    vi.mocked(searchArticles).mockResolvedValue([]);

    const outcomes = await fetchCourseFacts([
      { id: 1, name: "Some Course", wikipediaName: null },
    ]);

    expect(searchArticles).toHaveBeenCalledWith("Some Course");
    expect(outcomes[0]).toMatchObject({ status: "no-article", courseId: 1 });
  });

  it("reports both facts null for an article that carries neither", async () => {
    const { fetchIntro } = await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockResolvedValue({
      title: "Plain Course",
      revid: 9,
      wikitext: "{{Infobox golf facility\n| name = Plain Course\n}}",
    });

    const outcomes = await fetchCourseFacts([
      { id: 3, name: "Plain Course", wikipediaName: "Plain Course" },
    ]);

    expect(outcomes).toEqual([
      {
        status: "read",
        courseId: 3,
        name: "Plain Course",
        altitudeFeet: null,
        greenSurface: null,
        sourceUrl: "https://en.wikipedia.org/w/index.php?title=Plain_Course&oldid=9",
      },
    ]);
  });
});
