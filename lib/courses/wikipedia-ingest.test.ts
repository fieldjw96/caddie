import { describe, expect, it, vi } from "vitest";
import { fetchCourseFacts } from "./wikipedia-ingest";

vi.mock("../schedule/wikipedia", () => ({
  fetchIntro: vi.fn(),
  revisionUrl: (title: string, revid: number) =>
    `https://en.wikipedia.org/w/index.php?title=${title.replaceAll(" ", "_")}&oldid=${revid}`,
}));

describe("fetchCourseFacts", () => {
  it("reads both facts and the revision URL for a Course whose article resolves", async () => {
    const { fetchIntro } = await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockResolvedValue({
      title: "Bethpage Black Course",
      revid: 42,
      wikitext:
        "{{Infobox golf facility\n| elevation = {{convert|125|ft}}\n| greens = [[Poa annua]]\n}}",
    });

    const outcomes = await fetchCourseFacts([{ id: 1, name: "Bethpage Black Course" }]);

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
  });

  it("reports a Course whose article cannot be found without stopping the run", async () => {
    const { fetchIntro } = await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockImplementation((title: string) => {
      if (title === "No Such Course") return Promise.reject(new Error("no such article"));
      return Promise.resolve({
        title,
        revid: 7,
        wikitext: "{{Infobox golf facility\n| elevation = {{convert|400|ft}}\n}}",
      });
    });

    const outcomes = await fetchCourseFacts([
      { id: 1, name: "No Such Course" },
      { id: 2, name: "Real Course" },
    ]);

    expect(outcomes[0]).toEqual({
      status: "no-article",
      courseId: 1,
      name: "No Such Course",
      reason: "no such article",
    });
    expect(outcomes[1]).toMatchObject({ status: "read", courseId: 2, altitudeFeet: 400 });
  });

  it("reports both facts null for an article that carries neither", async () => {
    const { fetchIntro } = await import("../schedule/wikipedia");
    vi.mocked(fetchIntro).mockResolvedValue({
      title: "Plain Course",
      revid: 9,
      wikitext: "{{Infobox golf facility\n| name = Plain Course\n}}",
    });

    const outcomes = await fetchCourseFacts([{ id: 3, name: "Plain Course" }]);

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
