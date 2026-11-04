import { describe, expect, it, vi } from "vitest";
import { elevationUrl, POINTS_PER_REQUEST, readCourseAltitudes } from "./elevation";

const course = (id: number) => ({
  id,
  name: `Course ${id}`,
  latitude: 22.9,
  longitude: -109.98,
});

const answering = (elevation: number[]) =>
  vi.fn(async () => Response.json({ elevation })) as unknown as typeof fetch;

describe("readCourseAltitudes", () => {
  it("converts metres to whole feet and keeps the request as the Source", async () => {
    const [outcome] = await readCourseAltitudes([course(1)], answering([53]));
    expect(outcome).toEqual({
      status: "read",
      courseId: 1,
      name: "Course 1",
      altitudeFeet: 174,
      sourceUrl: elevationUrl([course(1)]),
    });
  });

  it("asks in batches of the most one request can read", async () => {
    const stored = Array.from({ length: POINTS_PER_REQUEST + 1 }, (_, i) => course(i));
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const points = new URL(String(url)).searchParams.get("latitude")!.split(",");
      return Response.json({ elevation: points.map(() => 10) });
    }) as unknown as typeof fetch;
    const outcomes = await readCourseAltitudes(stored, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(outcomes.every((o) => o.status === "read")).toBe(true);
  });

  it.each([
    ["a failed request", vi.fn(async () => new Response("", { status: 503 }))],
    ["the model's no-data value", answering([-32768])],
    ["a short answer", answering([])],
    ["the wrong shape", vi.fn(async () => Response.json({ height: [1] }))],
  ])("reports %s rather than storing it", async (_, fetchFn) => {
    const [outcome] = await readCourseAltitudes(
      [course(1)],
      fetchFn as unknown as typeof fetch,
    );
    expect(outcome?.status).toBe("unread");
  });
});
