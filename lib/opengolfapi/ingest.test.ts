// @vitest-environment node

import { describe, expect, it } from "vitest";
import augusta from "./fixtures/augusta-national.detail.json";
import bayHill from "./fixtures/bay-hill.search.json";
import { OpenGolfApiClient, RateLimitExhausted } from "./client";
import { ingestVenues, resolve, type CourseRow, type Venue } from "./ingest";
import { fakeFetch, type Reply } from "./test-fetch";

const ATTRIBUTION =
  "© OpenStreetMap contributors (ODbL 1.0) via OpenGolfAPI — https://opengolfapi.org/attribution";

const search = (courses: unknown[]) => ({
  courses,
  total: courses.length,
  _license: "ODbL-1.0",
  _attribution: ATTRIBUTION,
});

const augustaSearch = search([
  {
    id: "nine",
    course_name: "The Nine Hole At Augusta National Golf Club",
    city: "Augusta",
    state: "GA",
  },
  { id: augusta.id, course_name: "Augusta National Golf Club", city: "Augusta", state: "GA" },
]);

const AUGUSTA: Venue = {
  query: "Augusta National",
  name: "Augusta National Golf Club",
  state: "GA",
};
const BAY_HILL: Venue = {
  query: "Bay Hill",
  name: "Bay Hill Club Lodge Championship Course",
  state: "FL",
};

function client(routes: Record<string, Reply>) {
  const { fetch, requested } = fakeFetch(routes);
  return { api: new OpenGolfApiClient({ fetch, intervalMs: 0 }), requested };
}

describe("resolve", () => {
  it("picks the one course with the exact name and state out of its neighbours", async () => {
    // The real search for "Bay Hill" returns six courses in four states.
    const { api, requested } = client({ "/search": { body: bayHill } });
    const resolved = await resolve(api, BAY_HILL);
    expect(resolved.id).toBe("13fae2ba-51cf-436d-93da-2faa8cecc2c9");
    expect(resolved.attribution).toMatch(/ODbL/);
    expect(requested[0]).toContain("q=Bay+Hill");
    expect(requested[0]).toContain("state=FL");
  });

  it("refuses a name the search does not return, listing what it did", async () => {
    const { api } = client({ "/search": { body: bayHill } });
    await expect(resolve(api, { ...BAY_HILL, name: "Bay Hill Club" })).rejects.toThrow(
      /Bay Hills Golf Club \(NE\)/,
    );
  });

  it("refuses to guess between two courses of the same name and state", async () => {
    // The real Bay Hill search returns "Bay Hills Golf Club", Arnold MD, twice.
    const { api } = client({ "/search": { body: bayHill } });
    await expect(
      resolve(api, { query: "Bay Hill", name: "Bay Hills Golf Club", state: "MD" }),
    ).rejects.toThrow(/2 courses share/);
  });
});

describe("ingestVenues", () => {
  it("stores the facts, the Source and the attribution on the row", async () => {
    const { api } = client({
      "/search": { body: augustaSearch },
      [`/api/v1/courses/${augusta.id}`]: { body: augusta },
    });
    const stored: CourseRow[] = [];
    await ingestVenues(api, [AUGUSTA], async (row) => void stored.push(row));

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      name: "Augusta National Golf Club",
      openGolfApiId: augusta.id,
      par: 72,
      publishedYardage: 7445,
      architect: null,
      source: "opengolfapi",
      sourceUrl: `https://api.opengolfapi.org/api/v1/courses/${augusta.id}`,
      attribution: ATTRIBUTION,
      holesTrusted: false,
    });
    expect(stored[0]?.tees).toEqual([
      { name: "Black", gender: "Male", par: 72, yardage: 7445, rating: 76.2, slope: 148 },
      { name: "Member", gender: "Male", par: 72, yardage: 6365, rating: 67.7, slope: 118 },
    ]);
    expect(stored[0]?.holes?.[0]).toEqual({ number: 1, par: 4, yardages: { member: 365 } });
  });

  it("lets a changed shape cost that one course, not the run", async () => {
    const broken = structuredClone(augusta) as Record<string, unknown>;
    broken.holes_data = "eighteen";
    const { api } = client({
      "q=Augusta": { body: augustaSearch },
      "q=Bay": { body: bayHill },
      [`/api/v1/courses/${augusta.id}`]: { body: broken },
      "/api/v1/courses/13fae2ba": {
        body: { ...augusta, id: "13fae2ba", course_name: "Bay Hill" },
      },
    });
    const stored: CourseRow[] = [];
    const outcomes = await ingestVenues(api, [AUGUSTA, BAY_HILL], async (row) => {
      stored.push(row);
    });

    expect(outcomes.map((o) => o.ok)).toEqual([false, true]);
    expect(outcomes[0]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/holes_data/),
    });
    expect(stored.map((r) => r.name)).toEqual(["Bay Hill"]);
  });

  it("ends the run when the daily limit is used up", async () => {
    const { api } = client({ "/search": { status: 429 } });
    await expect(ingestVenues(api, [AUGUSTA, BAY_HILL], async () => {})).rejects.toThrow(
      RateLimitExhausted,
    );
  });
});
