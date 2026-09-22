// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DAILY_REQUEST_LIMIT,
  OpenGolfApiClient,
  RateLimitExhausted,
  RequestError,
} from "./client";
import { ShapeError } from "./schema";
import { fakeFetch, type Reply } from "./test-fetch";

const anything = z.object({ ok: z.boolean() });

/** A client on a fake clock, recording every wait it asks for. */
function client(routes: Record<string, Reply>, options: { budget?: number } = {}) {
  let clock = 0;
  const waits: number[] = [];
  const { fetch, requested } = fakeFetch(routes);
  const api = new OpenGolfApiClient({
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    intervalMs: 1_000,
    ...options,
  });
  return { api, waits, requested, advance: (ms: number) => (clock += ms) };
}

describe("OpenGolfApiClient", () => {
  it("allows 500 requests a day, as observed rather than as documented", () => {
    expect(DAILY_REQUEST_LIMIT).toBe(500);
  });

  it("spaces requests by the interval, and does not wait when it has already passed", async () => {
    const { api, waits, advance } = client({ "/a": { body: { ok: true } } });
    await api.get("/a", anything);
    await api.get("/a", anything);
    advance(400);
    await api.get("/a", anything);
    advance(5_000);
    await api.get("/a", anything);
    expect(waits).toEqual([1_000, 600]);
  });

  it("refuses to send more than its budget", async () => {
    const { api, requested } = client({ "/a": { body: { ok: true } } }, { budget: 2 });
    await api.get("/a", anything);
    await api.get("/a", anything);
    await expect(api.get("/a", anything)).rejects.toThrow(RateLimitExhausted);
    expect(requested).toHaveLength(2);
  });

  it("never takes a budget above the daily limit", async () => {
    const { api } = client({ "/a": { body: { ok: true } } }, { budget: 10_000 });
    for (let i = 0; i < DAILY_REQUEST_LIMIT; i++) await api.get("/a", anything);
    await expect(api.get("/a", anything)).rejects.toThrow(RateLimitExhausted);
  });

  it("stops once the server says nothing remains today", async () => {
    const { api, requested } = client({
      "/a": { body: { ok: true }, headers: { "x-ratelimit-remaining": "0" } },
    });
    await api.get("/a", anything);
    await expect(api.get("/a", anything)).rejects.toThrow(/0 remaining/);
    expect(requested).toHaveLength(1);
  });

  it("treats 429 as the end of the run", async () => {
    const { api } = client({ "/a": { status: 429 } });
    await expect(api.get("/a", anything)).rejects.toThrow(RateLimitExhausted);
  });

  it("treats any other failure as the failure of one request", async () => {
    const { api } = client({ "/a": { status: 500 } });
    await expect(api.get("/a", anything)).rejects.toThrow(RequestError);
  });

  it("parses every body through the schema it is given", async () => {
    const { api } = client({ "/a": { body: { ok: "yes" } } });
    await expect(api.get("/a", anything)).rejects.toThrow(ShapeError);
    await expect(api.get("/a", anything)).rejects.toThrow(/ok:/);
  });
});
