import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchArticle, fetchIntro, MissingArticleError, revisionUrl } from "./wikipedia";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const PARSE_OK = {
  parse: { title: "2026 PGA Tour", revid: 12345, wikitext: "some wikitext" },
};

/** Fires a request-returning call and immediately flushes the module's throttle delay. */
async function callThrough<T>(call: () => Promise<T>): Promise<T> {
  const result = call();
  // A no-op handler so a rejection isn't briefly "unhandled" while timers are flushed below;
  // the real handling still happens through the returned promise.
  result.catch(() => {});
  await vi.runAllTimersAsync();
  return result;
}

beforeEach(() => {
  // Fake timers so the module's real one-request-a-second throttle doesn't make every test
  // in this file actually wait a second: the throttle logic itself gets its own test below.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchArticle", () => {
  it("sends a descriptive User-Agent naming the project and a contact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PARSE_OK));
    vi.stubGlobal("fetch", fetchMock);

    await callThrough(() => fetchArticle("2026 PGA Tour"));

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const userAgent = (init.headers as Record<string, string>)["User-Agent"];
    expect(userAgent).toMatch(/Caddie/);
    expect(userAgent).toMatch(/github\.com\/fieldjw96\/caddie/);
  });

  it("asks the API for wikitext, revid and redirect-following", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PARSE_OK));
    vi.stubGlobal("fetch", fetchMock);

    await callThrough(() => fetchArticle("2026 PGA Tour"));

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("action")).toBe("parse");
    expect(url.searchParams.get("redirects")).toBe("1");
    expect(url.searchParams.get("prop")).toBe("wikitext|revid");
  });

  it("throws, naming the page, when the API returns an error payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: "badvalue", info: "bad section" } })),
    );

    const error = await callThrough(() => fetchArticle("2026 PGA Tour")).catch((e) => e);
    expect(error).not.toBeInstanceOf(MissingArticleError);
    expect(String(error)).toMatch(/badvalue/);
    expect(String(error)).toMatch(/2026 PGA Tour/);
  });

  it("throws a MissingArticleError, naming the page, when the article does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: "missingtitle", info: "gone" } })),
    );

    const error = await callThrough(() => fetchArticle("2027 Masters Tournament")).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(MissingArticleError);
    expect(String(error)).toMatch(/2027 Masters Tournament/);
  });

  it("throws when the response no longer matches the expected shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ parse: { title: "x" } })));

    await expect(callThrough(() => fetchArticle("2026 PGA Tour"))).rejects.toThrow();
  });

  it("decodes HTML entities out of the wikitext it returns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          parse: {
            title: "2026 RBC Canadian Open",
            revid: 1,
            wikitext: "| course = [[TPC Toronto at Osprey&nbsp;Valley]] (North&nbsp;course)",
          },
        }),
      ),
    );

    const article = await callThrough(() => fetchArticle("2026 RBC Canadian Open"));
    expect(article.wikitext).toBe(
      "| course = [[TPC Toronto at Osprey Valley]] (North course)",
    );
  });
});

describe("fetchIntro", () => {
  it("requests section 0, the lead, with no section lookup call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PARSE_OK));
    vi.stubGlobal("fetch", fetchMock);

    await callThrough(() => fetchIntro("2026 PGA Tour"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("section")).toBe("0");
  });

  it("throws a MissingArticleError, naming the page, when the article does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: "missingtitle", info: "gone" } })),
    );

    const error = await callThrough(() => fetchIntro("Tpc Deere Run")).catch((e) => e);
    expect(error).toBeInstanceOf(MissingArticleError);
    expect(String(error)).toMatch(/Tpc Deere Run/);
  });
});

describe("throttling", () => {
  it("never issues two requests less than a second apart", async () => {
    const timestamps: number[] = [];
    const fetchMock = vi.fn().mockImplementation(() => {
      timestamps.push(Date.now());
      return Promise.resolve(jsonResponse(PARSE_OK));
    });
    vi.stubGlobal("fetch", fetchMock);

    const call = fetchArticle("2026 PGA Tour").then(() => fetchArticle("2027 PGA Tour"));
    await vi.runAllTimersAsync();
    await call;

    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(1000);
  });
});

describe("revisionUrl", () => {
  it("links to the exact revision, not just the article", () => {
    expect(revisionUrl("2026 PGA Tour", 1375908507)).toBe(
      "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1375908507",
    );
  });
});
