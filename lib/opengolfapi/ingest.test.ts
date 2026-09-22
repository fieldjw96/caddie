// @vitest-environment node

import { describe, expect, it } from "vitest";
import augusta from "./fixtures/augusta-national.detail.json";
import bayHill from "./fixtures/bay-hill.search.json";
import { OpenGolfApiClient } from "./client";
import { planCourses, RunStopped, toCourseRow, type ScheduledTournament } from "./ingest";
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

const BAY_HILL_ID = "13fae2ba-51cf-436d-93da-2faa8cecc2c9";

let nextId = 1;
const tournament = (
  name: string,
  courseName: string | null,
  location: string | null,
): ScheduledTournament => ({ id: nextId++, name, courseName, location });

const MASTERS = tournament("Masters Tournament", "Augusta National Golf Club", "Georgia");
const ARNOLD_PALMER = tournament(
  "Arnold Palmer Invitational",
  "Bay Hill Club and Lodge",
  "Florida",
);

function client(routes: Record<string, Reply>, budget?: number) {
  const { fetch, requested } = fakeFetch(routes);
  return { api: new OpenGolfApiClient({ fetch, intervalMs: 0, budget }), requested };
}

const augustaRoutes: Record<string, Reply> = {
  "q=augusta": { body: augustaSearch },
  [`/api/v1/courses/${augusta.id}`]: { body: augusta },
};

describe("toCourseRow", () => {
  it("stores the facts, the Source and the attribution on the row", () => {
    const row = toCourseRow(augusta as Parameters<typeof toCourseRow>[0], ATTRIBUTION);
    expect(row).toMatchObject({
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
    expect(row.tees).toEqual([
      { name: "Black", gender: "Male", par: 72, yardage: 7445, rating: 76.2, slope: 148 },
      { name: "Member", gender: "Male", par: 72, yardage: 6365, rating: 67.7, slope: 118 },
    ]);
    expect(row.holes?.[0]).toEqual({ number: 1, par: 4, yardages: { member: 365 } });
  });
});

describe("planCourses", () => {
  it("matches each Tournament within its state and fetches the course once", async () => {
    const { api, requested } = client(augustaRoutes);
    const again = { ...MASTERS, id: nextId++, name: "Masters Tournament (moved)" };
    const plan = await planCourses(api, [MASTERS, again]);

    expect(plan.outcomes.map((o) => o.resolution)).toEqual([
      {
        status: "matched",
        scheduleName: "Augusta National Golf Club",
        confidence: "exact",
        openGolfApiId: augusta.id,
        openGolfApiName: "Augusta National Golf Club",
      },
      expect.objectContaining({ status: "matched", openGolfApiId: augusta.id }),
    ]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ attribution: ATTRIBUTION, holesTrusted: false });
    expect(requested).toHaveLength(2);
    expect(requested[0]).toContain("q=augusta+national");
    expect(requested[0]).toContain("state=GA");
  });

  it("uses a declared pairing where the names differ, and records that it was declared", async () => {
    const { api } = client({
      "q=bay+hill": { body: bayHill },
      [`/api/v1/courses/${BAY_HILL_ID}`]: {
        body: {
          ...augusta,
          id: BAY_HILL_ID,
          course_name: "Bay Hill Club Lodge Championship Course",
        },
      },
    });
    const plan = await planCourses(api, [ARNOLD_PALMER]);
    expect(plan.outcomes[0]?.resolution).toMatchObject({
      status: "matched",
      scheduleName: "Bay Hill Club and Lodge",
      confidence: "declared",
      openGolfApiName: "Bay Hill Club Lodge Championship Course",
    });
  });

  it("reports, without a request, what it cannot search for", async () => {
    const { api, requested } = client({});
    const plan = await planCourses(api, [
      tournament("Austin Championship", null, "Texas"),
      tournament("Two Course Classic", "Old Club, (East Course), (West Course)", "Ohio"),
      tournament("Nowhere Open", "Some Golf Club", null),
    ]);
    expect(plan.outcomes.map((o) => o.resolution)).toEqual([
      { status: "failed", scheduleName: null, reason: "the schedule names no Course" },
      expect.objectContaining({ status: "failed", reason: expect.stringMatching(/lists 2/) }),
      expect.objectContaining({ status: "failed", reason: expect.stringMatching(/Location/) }),
    ]);
    expect(requested).toHaveLength(0);
  });

  it("tries the shorter query when the longer finds nothing", async () => {
    const { api, requested } = client({
      "q=dunes+beach": { body: search([]) },
      "q=dunes&": {
        body: search([
          { id: "dunes", course_name: "The Dunes Golf Beach Club", city: null, state: "SC" },
        ]),
      },
      "/api/v1/courses/dunes": { body: { ...augusta, id: "dunes", yardage: 7370 } },
    });
    const plan = await planCourses(api, [
      tournament("Myrtle Beach Classic", "Dunes Golf and Beach Club", "South Carolina"),
    ]);
    expect(plan.outcomes[0]?.resolution).toMatchObject({
      status: "matched",
      confidence: "normalised",
    });
    expect(requested).toHaveLength(3);
  });

  it("leaves a near-miss unmatched and says what search returned", async () => {
    const { api, requested } = client({ "q=bay+hill": { body: bayHill } });
    const plan = await planCourses(api, [
      tournament("Bay Hills Open", "Bay Hill Country Club", "Florida"),
    ]);
    const [outcome] = plan.outcomes;
    expect(outcome?.resolution.status).toBe("near-miss");
    if (outcome?.resolution.status !== "near-miss") return;
    expect(outcome.resolution.scheduleName).toBe("Bay Hill Country Club");
    expect(outcome.resolution.candidates).toContain("Bay Hills Recreation Park (LA)");
    expect(plan.rows).toHaveLength(0);
    expect(requested).toHaveLength(1);
  });

  it("unmatches a course whose record is of something else", async () => {
    const { api } = client({
      "q=colonial": {
        body: search([
          { id: "col", course_name: "Colonial Country Club", city: "Fort Worth", state: "TX" },
        ]),
      },
      "/api/v1/courses/col": {
        body: { ...augusta, id: "col", par: 58, yardage: 2194, holes_data: null },
      },
    });
    const plan = await planCourses(api, [
      tournament("Charles Schwab Challenge", "Colonial Country Club", "Texas"),
    ]);
    expect(plan.outcomes[0]?.resolution).toMatchObject({
      status: "failed",
      scheduleName: "Colonial Country Club",
      reason: expect.stringMatching(/par 58/),
    });
    expect(plan.rows).toHaveLength(0);
  });

  it("lets a changed shape cost that one course, not the run", async () => {
    const broken = structuredClone(augusta) as Record<string, unknown>;
    broken.holes_data = "eighteen";
    const { api } = client({
      "q=augusta": { body: augustaSearch },
      "q=bay+hill": { body: bayHill },
      [`/api/v1/courses/${augusta.id}`]: { body: broken },
      [`/api/v1/courses/${BAY_HILL_ID}`]: { body: { ...augusta, id: BAY_HILL_ID } },
    });
    const plan = await planCourses(api, [MASTERS, ARNOLD_PALMER]);
    expect(plan.outcomes.map((o) => o.resolution.status)).toEqual(["failed", "matched"]);
    expect(plan.outcomes[0]?.resolution).toMatchObject({
      reason: expect.stringMatching(/holes_data/),
    });
    expect(plan.rows.map((r) => r.openGolfApiId)).toEqual([BAY_HILL_ID]);
  });

  it("does not start a run it cannot finish", async () => {
    // Two searches may cost six requests; a budget of five cannot promise them.
    const { api, requested } = client(augustaRoutes, 5);
    await expect(planCourses(api, [MASTERS, ARNOLD_PALMER])).rejects.toThrow(
      /Stopped before writing anything, having searched for 0 of 2 Courses\..*6 more requests are needed and 5 remain/,
    );
    expect(requested).toHaveLength(0);
  });

  it("stops as soon as the server says too little remains, saying how far it got", async () => {
    const { api, requested } = client({
      "q=augusta": { body: augustaSearch, headers: { "x-ratelimit-remaining": "2" } },
    });
    await expect(planCourses(api, [MASTERS, ARNOLD_PALMER])).rejects.toThrow(
      /searched for 1 of 2 Courses\..*3 more requests are needed and 2 remain/,
    );
    expect(requested).toHaveLength(1);
  });

  it("stops on a 429 rather than carrying on", async () => {
    const { api } = client({ "/search": { status: 429 } });
    await expect(planCourses(api, [MASTERS])).rejects.toThrow(RunStopped);
  });
});
